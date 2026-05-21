/**
 * CanvasMode — Excalidraw whiteboard rendered inside the React overlay.
 *
 * Uses @excalidraw/excalidraw for a full-featured drawing experience.
 * Lazy-loads Excalidraw on first mount (heavy dependency).
 * Exposes scene access via window.cloeExcalidraw for programmatic interaction.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import '@excalidraw/excalidraw/index.css';

export default function CanvasMode() {
  const [ExcalidrawComponent, setExcalidrawComponent] = useState(null);
  const excalidrawRef = useRef(null);
  const [loading, setLoading] = useState(true);

  // Lazy-load Excalidraw
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        // Excalidraw is a heavy dependency — load on demand
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
        getSceneElements: () => api.getSceneElements(),
        updateScene: (elements) => api.updateScene({ elements }),
        resetScene: () => {
          api.updateScene({ elements: [] });
        },
        getAppState: () => api.getAppState(),
      };
      console.log('[Canvas] Excalidraw API exposed on window.cloeExcalidraw');
    }
  }, []);

  return (
    <div className="canvas-overlay" style={{
      position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
      display: 'flex', flexDirection: 'column', overflow: 'hidden',
      background: 'rgba(10, 10, 20, 0.72)',
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
            initialData={{
              appState: {
                viewBackgroundColor: '#1e1e2e',
              },
            }}
            UIOptions={{
              canvasActions: {
                loadScene: true,
                export: {
                  saveFileToDisk: true,
                },
              },
            }}
            theme="dark"
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
