/**
 * Cloe Canvas — Renderer stub for the canvas window.
 *
 * This module manages the HTML5 <canvas> element that fills the canvas window.
 * In T2, the actual Element data model and rendering logic will be added here.
 *
 * Current scope (T1):
 * - Resize canvas to fill window (with devicePixelRatio support)
 * - Draw a placeholder background so the window isn't blank
 */

(function () {
  'use strict';

  const canvas = document.getElementById('cloe-canvas');
  const ctx = canvas.getContext('2d');

  let width = 0;
  let height = 0;

  /**
   * Resize the canvas to match the window's inner dimensions.
   * Accounts for devicePixelRatio for crisp rendering on HiDPI displays.
   */
  function resize() {
    const dpr = window.devicePixelRatio || 1;
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = width + 'px';
    canvas.style.height = height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawPlaceholder();
  }

  /**
   * Draw a placeholder grid so the canvas window isn't blank.
   * This will be replaced by actual rendering in T2.
   */
  function drawPlaceholder() {
    // Background
    ctx.fillStyle = '#1a1a2e';
    ctx.fillRect(0, 0, width, height);

    // Grid
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1;
    const gridSize = 40;
    for (let x = 0; x <= width; x += gridSize) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    for (let y = 0; y <= height; y += gridSize) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    // Center text
    ctx.fillStyle = 'rgba(255, 255, 255, 0.15)';
    ctx.font = '14px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Cloe Canvas — Ready', width / 2, height / 2 - 10);
    ctx.font = '12px -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif';
    ctx.fillStyle = 'rgba(255, 255, 255, 0.08)';
    ctx.fillText('Annotations will appear here (T5)', width / 2, height / 2 + 14);
  }

  // Initial resize and listen for window resize
  window.addEventListener('resize', resize);
  resize();

  console.log('[Canvas] Initialized', { width, height, dpr: window.devicePixelRatio });
})();
