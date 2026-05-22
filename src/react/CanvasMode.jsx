/**
 * CanvasMode — Excalidraw whiteboard rendered inside the React overlay.
 *
 * Uses @excalidraw/excalidraw for a full-featured drawing experience.
 * Lazy-loads Excalidraw on first mount (heavy dependency).
 * Exposes scene access via window.cloeExcalidraw for programmatic interaction.
 */

import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { convertToExcalidrawElements } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

const INITIAL_DATA = {
  appState: {
    viewBackgroundColor: 'transparent',
  },
};

// Stable UI options — inline objects on every render would reset Excalidraw state
const UI_OPTIONS = {
  canvasActions: {
    loadScene: true,
    export: {
      saveFileToDisk: true,
    },
  },
};

export default function CanvasMode() {
  const [ExcalidrawComponent, setExcalidrawComponent] = useState(null);
  const excalidrawRef = useRef(null);
  const elementsRef = useRef([]); // authoritative source of truth
  const [loading, setLoading] = useState(true);

  // Lazy-load Excalidraw
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@excalidraw/excalidraw');
        if (cancelled) return;
        setExcalidrawComponent(() => mod.Excalidraw);
        setLoading(false);
      } catch (err) {
        console.error('[Canvas] Failed to load Excalidraw:', err);
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // Expose API for programmatic access (Hermes, etc.)
  const handleExcalidrawAPI = useCallback((api) => {
    if (api) {
      excalidrawRef.current = api;
      window.cloeExcalidraw = {
        getSceneElements: () => elementsRef.current,
        updateScene: (skeletons) => {
          const incoming = Array.isArray(skeletons) ? skeletons : [];
          // Use official API to convert skeletons → fully qualified elements
          // This correctly computes text width/height and fills all required fields
          const converted = convertToExcalidrawElements(incoming, { regenerateIds: false });

          // Auto-fit bounding containers (rectangles) to their bound text.
          // If a text element has boundElements referencing a container,
          // resize the container to fit the text with padding.
          const PAD = 24;
          const map = new Map(converted.map(el => [el.id, el]));
          converted.forEach(el => {
            if (el.type === 'text' && el.boundElements) {
              el.boundElements.forEach(be => {
                const container = map.get(be.id);
                if (container && (container.type === 'rectangle' || container.type === 'ellipse' || container.type === 'diamond')) {
                  // Container position is already set in skeleton; just adjust size
                  container.width = Math.max(container.width, el.width + PAD * 2);
                  container.height = Math.max(container.height, el.height + PAD * 2);
                  // Re-center text within container
                  el.x = container.x + (container.width - el.width) / 2;
                  el.y = container.y + (container.height - el.height) / 2;
                }
              });
            }
          });

          // Merge into our ref: new elements overwrite by id
          const allMap = new Map(elementsRef.current.map(el => [el.id, el]));
          converted.forEach(el => allMap.set(el.id, el));
          elementsRef.current = Array.from(allMap.values());
          api.updateScene({ elements: elementsRef.current });
          api.scrollToContent(undefined, { fitToContent: true });
        },
        resetScene: () => {
          elementsRef.current = [];
          api.updateScene({ elements: [] });
        },
        getAppState: () => api.getAppState(),

        // ── Attention-guiding operations ──

        /**
         * Zoom the canvas to a specific level.
         * @param {number} level - zoom value (e.g. 1 = 100%, 2 = 200%)
         */
        zoomTo: (level) => {
          const state = api.getAppState();
          api.updateScene({ appState: { zoom: { value: level } } });
        },

        /**
         * Pan the canvas so that (x, y) in scene coordinates is at the center.
         * @param {number} x - scene X
         * @param {number} y - scene Y
         */
        panTo: (x, y) => {
          const state = api.getAppState();
          const { zoom, scrollX, scrollY } = state;
          const z = typeof zoom === 'object' ? zoom.value : zoom;
          const cx = window.innerWidth / 2;
          const cy = window.innerHeight / 2;
          api.updateScene({ appState: { scrollX: cx / z - x, scrollY: cy / z - y } });
        },

        /**
         * Select elements by id (highlights them with selection handles).
         * @param {string[]} ids
         */
        selectElements: (ids) => {
          const selected = {};
          ids.forEach(id => { selected[id] = true; });
          api.updateScene({ appState: { selectedElementIds: selected } });
        },

        /**
         * Clear all selections.
         */
        deselectAll: () => {
          api.updateScene({ appState: { selectedElementIds: {} } });
        },

        /**
         * Focus camera on one or more elements — zoom + pan to center them with padding.
         * Also selects them for visual highlight.
         * @param {string[]} ids - element ids to focus on
         */
        focusElements: (ids) => {
          const els = elementsRef.current.filter(el => ids.includes(el.id));
          if (els.length === 0) return;

          // Compute bounding box of target elements
          let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
          els.forEach(el => {
            const x = el.x, y = el.y;
            const w = el.width || 0, h = el.height || 0;
            // Handle rotated elements
            if (el.angle && el.angle !== 0) {
              const cx = x + w / 2, cy = y + h / 2;
              const rad = (el.angle * Math.PI) / 180;
              const corners = [[x, y], [x + w, y], [x, y + h], [x + w, y + h]];
              corners.forEach(([px, py]) => {
                const rx = cx + (px - cx) * Math.cos(rad) - (py - cy) * Math.sin(rad);
                const ry = cy + (px - cx) * Math.sin(rad) + (py - cy) * Math.cos(rad);
                minX = Math.min(minX, rx); minY = Math.min(minY, ry);
                maxX = Math.max(maxX, rx); maxY = Math.max(maxY, ry);
              });
            } else {
              minX = Math.min(minX, x); minY = Math.min(minY, y);
              maxX = Math.max(maxX, x + w); maxY = Math.max(maxY, y + h);
            }
          });

          const padding = 80;
          const contentW = maxX - minX + padding * 2;
          const contentH = maxY - minY + padding * 2;
          const viewW = window.innerWidth;
          const viewH = window.innerHeight - 40; // minus header
          const zoomLevel = Math.min(viewW / contentW, viewH / contentH, 3);

          const centerX = (minX + maxX) / 2;
          const centerY = (minY + maxY) / 2;

          api.updateScene({
            appState: {
              zoom: { value: zoomLevel },
              scrollX: viewW / 2 / zoomLevel - centerX,
              scrollY: (viewH / 2 + 20) / zoomLevel - centerY,
              selectedElementIds: Object.fromEntries(ids.map(id => [id, true])),
            },
          });
        },

        /**
         * Delete elements by id (soft delete — sets isDeleted: true).
         * @param {string[]} ids
         */
        deleteElements: (ids) => {
          const idSet = new Set(ids);
          elementsRef.current = elementsRef.current.map(el =>
            idSet.has(el.id) ? { ...el, isDeleted: true } : el
          );
          api.updateScene({ elements: elementsRef.current });
        },
      };
      console.log('[Canvas] Excalidraw API exposed on window.cloeExcalidraw (skeleton mode)');
    }
  }, []);

  // onChange — sync Excalidraw internal state back to our ref
  // This preserves user-drawn elements across programmatic updates
  const handleChange = useCallback((_elements, _appState) => {
    if (_elements && _elements.length > 0) {
      const map = new Map(elementsRef.current.map(el => [el.id, el]));
      _elements.forEach(el => map.set(el.id, el));
      elementsRef.current = Array.from(map.values());
    }
  }, []);

  return (
    <div className="canvas-overlay" style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
    }}>
      {/* Header bar */}
      <div className="canvas-header-integrated">
        <span className="canvas-title">🎨 Canvas</span>
        <span className="canvas-info" style={{ fontSize: 11, opacity: 0.7 }}>
          {loading ? 'Loading Excalidraw...' : 'Excalidraw'}
        </span>
      </div>

      {/* Excalidraw workspace */}
      <div style={{ flex: 1, position: 'relative' }}>
        {loading ? (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: 'rgba(255,255,255,0.5)', fontSize: 14, fontFamily: 'monospace',
          }}>
            Loading Excalidraw...
          </div>
        ) : ExcalidrawComponent ? (
          <ExcalidrawComponent
            ref={excalidrawRef}
            excalidrawAPI={handleExcalidrawAPI}
            initialData={INITIAL_DATA}
            UIOptions={UI_OPTIONS}
            onChange={handleChange}
            theme="light"
          />
        ) : (
          <div style={{
            position: 'absolute', inset: 0,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            color: '#ef5350', fontSize: 14, fontFamily: 'monospace',
          }}>
            Failed to load Excalidraw
          </div>
        )}
      </div>
    </div>
  );
}
