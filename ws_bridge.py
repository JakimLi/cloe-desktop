#!/usr/bin/env python3
"""
cloe-desktop WebSocket Bridge

同时提供:
  - WebSocket server on :19850 (Electron客户端连接)
  - HTTP server on :19851 (Hermes通过curl触发action)

用法:
  python3 ws_bridge.py            # 前台运行
  python3 ws_bridge.py &          # 后台运行
  
  # 触发动作
  curl -s http://localhost:19851/action -d '{"action":"approve"}'
  curl -s http://localhost:19851/action -d '{"action":"expression","expression":"happy"}'
  curl -s http://localhost:19851/action -d '{"action":"wave"}'
  
  # 查看连接状态
  curl -s http://localhost:19851/status
"""

import json
import sys
import asyncio
import signal
import os

from aiohttp import web

WS_PORT = 19850
HTTP_PORT = 19851

clients: set[web.WebSocketResponse] = set()


async def websocket_handler(request):
    """Electron客户端通过WS连接到这里"""
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    clients.add(ws)
    print(f"[WS] 客户端连接 (当前 {len(clients)} 个)")
    try:
        async for msg in ws:
            if msg.type == web.WSMsgType.TEXT:
                data = json.loads(msg.data)
                print(f"[WS] 收到: {data}")
            elif msg.type == web.WSMsgType.ERROR:
                print(f"[WS] 错误: {ws.exception()}")
    finally:
        clients.discard(ws)
        print(f"[WS] 客户端断开 (当前 {len(clients)} 个)")
    return ws


async def action_handler(request):
    """Hermes通过HTTP POST触发action，推送到所有WS客户端"""
    try:
        data = await request.json()
    except Exception:
        return web.json_response({"error": "invalid JSON"}, status=400)

    if not clients:
        return web.json_response({"warn": "no WS clients connected", "sent_to": 0})

    msg = json.dumps(data)
    sent = 0
    dead = set()
    for ws in clients:
        try:
            await ws.send_str(msg)
            sent += 1
        except Exception:
            dead.add(ws)

    for ws in dead:
        clients.discard(ws)

    print(f"[HTTP] action={data.get('action')} → {sent} 客户端")
    return web.json_response({"sent_to": sent, "action": data})


async def status_handler(request):
    """查看连接状态"""
    return web.json_response({
        "ws_port": WS_PORT,
        "http_port": HTTP_PORT,
        "clients": len(clients),
    })


def create_app():
    app = web.Application()
    app.router.add_get("/ws", websocket_handler)
    app.router.add_post("/action", action_handler)
    app.router.add_get("/status", status_handler)
    return app


async def main():
    app = create_app()
    runner = web.AppRunner(app)
    await runner.setup()

    # WS on 19850
    site_ws = web.TCPSite(runner, "127.0.0.1", WS_PORT)
    await site_ws.start()
    print(f"WebSocket server: ws://127.0.0.1:{WS_PORT}")

    # HTTP on 19851
    site_http = web.TCPSite(runner, "127.0.0.1", HTTP_PORT)
    await site_http.start()
    print(f"HTTP API: http://127.0.0.1:{HTTP_PORT}")
    print(f"触发动作: curl -s http://localhost:{HTTP_PORT}/action -d '{{\"action\":\"approve\"}}'")
    print("等待客户端连接...")

    # Keep alive
    try:
        await asyncio.Event().wait()
    except asyncio.CancelledError:
        pass
    finally:
        await runner.cleanup()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n已停止")
