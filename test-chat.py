#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
EnderRealm Assistant Agent - 测试脚本
支持创建会话、聊天、获取上下文、导出/导入等操作
适配 ReAct Agent SSE 事件协议 (reasoning/tool_call/tool_result/final_answer/error)
"""

import json
import sys
import io
from typing import Optional

# Fix Windows console encoding issues
if sys.platform == 'win32':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

try:
    import requests
except ImportError:
    print("please install requests: pip install requests")
    sys.exit(1)

BASE_URL = "http://localhost:8787"
SESSION_FILE = ".session.json"

# ANSI color codes for terminal output
class Colors:
    RESET = "\033[0m"
    BOLD = "\033[1m"
    DIM = "\033[2m"
    CYAN = "\033[36m"
    GREEN = "\033[32m"
    YELLOW = "\033[33m"
    BLUE = "\033[34m"
    MAGENTA = "\033[35m"
    RED = "\033[31m"
    GRAY = "\033[90m"

session_id: Optional[str] = None
session_token: Optional[str] = None


def load_session():
    """Load session from file"""
    global session_id, session_token
    try:
        with open(SESSION_FILE, "r", encoding="utf-8") as f:
            data = json.load(f)
            session_id = data.get("id")
            session_token = data.get("token")
    except (FileNotFoundError, json.JSONDecodeError):
        pass


def save_session():
    """Save session to file"""
    if session_id and session_token:
        with open(SESSION_FILE, "w", encoding="utf-8") as f:
            json.dump({"id": session_id, "token": session_token}, f)


def clear_session():
    """Clear session file"""
    global session_id, session_token
    session_id = None
    session_token = None
    try:
        import os
        os.remove(SESSION_FILE)
    except FileNotFoundError:
        pass


def headers():
    """构建请求头"""
    h = {"Content-Type": "application/json"}
    if session_token:
        h["X-Session-Token"] = session_token
    return h


def cmd_create():
    """创建新会话"""
    global session_id, session_token
    resp = requests.post(f"{BASE_URL}/api/session/create", headers={"Content-Type": "application/json"})
    if resp.status_code != 201:
        print(f"[FAIL] Create failed: {resp.text}")
        return

    data = resp.json()
    session_id = data["id"]
    session_token = data["token"]
    save_session()
    print(f"[OK] Session created")
    print(f"  ID:    {session_id}")
    print(f"  Token: {session_token}")


def cmd_chat(message: str):
    """发送消息并解析 ReAct Agent SSE 事件流"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.post(
        f"{BASE_URL}/api/chat",
        headers=headers(),
        json={"sessionId": session_id, "message": message},
        stream=True,
    )

    if resp.status_code == 401:
        print(f"{Colors.RED}[FAIL] Auth failed: {resp.text}{Colors.RESET}")
        return
    elif resp.status_code != 200:
        print(f"{Colors.RED}[FAIL] Request failed [{resp.status_code}]: {resp.text}{Colors.RESET}")
        return

    print("-" * 50)

    current_event = None
    final_answer = ""
    in_reasoning = False

    for line in resp.iter_lines():
        if not line:
            continue

        # 手动解码，确保 Windows 下 UTF-8 正确处理
        raw = line.decode('utf-8', errors='replace') if isinstance(line, bytes) else line

        # SSE format: lines starting with "event:" or "data:"
        if raw.startswith("event: "):
            current_event = raw[7:].strip()
            continue

        if raw.startswith("data: "):
            data_str = raw[6:].strip()
            if not data_str or data_str == "[DONE]":
                continue

            try:
                data = json.loads(data_str)
            except json.JSONDecodeError:
                continue

            content = data.get("content", "")
            done = data.get("done", False)

            if current_event == "reasoning":
                # AI 推理过程 — 用蓝色显示
                if not in_reasoning:
                    print(f"\n{Colors.BLUE}{Colors.DIM}💭 推理: {Colors.RESET}", end="", flush=True)
                    in_reasoning = True
                if content:
                    print(f"{Colors.BLUE}{Colors.DIM}{content}{Colors.RESET}", end="", flush=True)

            elif current_event == "tool_call":
                in_reasoning = False
                tool_name = data.get("name", "unknown")
                tool_args = data.get("arguments", {})
                # 工具调用 — 用黄色显示
                args_str = json.dumps(tool_args, ensure_ascii=False) if isinstance(tool_args, dict) else str(tool_args)
                print(f"\n{Colors.YELLOW}{Colors.BOLD}🔧 调用工具: {tool_name}{Colors.RESET}")
                print(f"{Colors.YELLOW}{Colors.DIM}   参数: {args_str}{Colors.RESET}", flush=True)

            elif current_event == "tool_result":
                in_reasoning = False
                tool_name = data.get("name", "unknown")
                result_preview = data.get("result", "")
                if result_preview:
                    # 截断过长的结果预览
                    preview = result_preview[:200]
                    if len(result_preview) > 200:
                        preview += "..."
                    print(f"{Colors.GREEN}{Colors.DIM}📋 工具结果 [{tool_name}]:{Colors.RESET}")
                    print(f"{Colors.GREEN}{Colors.DIM}   {preview}{Colors.RESET}", flush=True)

            elif current_event == "final_answer":
                in_reasoning = False
                if content:
                    if not final_answer:
                        # 首次收到 final_answer，打印前缀
                        print(f"\n{Colors.BOLD}🤖 EnderRealm帮帮:{Colors.RESET} ", end="", flush=True)
                    final_answer += content
                    print(content, end="", flush=True)
                if done:
                    print()  # 换行
                    print()

            elif current_event == "error":
                in_reasoning = False
                error_msg = data.get("error", "Unknown error")
                print(f"\n{Colors.RED}❌ 错误: {error_msg}{Colors.RESET}")
                print()

            current_event = None

    # 如果没有收到 final_answer 但有内容流出，兜底
    if final_answer:
        print()


def cmd_info():
    """查看会话信息"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/{session_id}", headers=headers())
    if resp.status_code != 200:
        print(f"[FAIL] Get failed: {resp.text}")
        return

    data = resp.json()
    print(f"Session ID: {data['id']}")
    print(f"Messages:   {data['messageCount']}")
    print(f"Created:   {data['createdAt']}")
    print(f"Updated:   {data['updatedAt']}")


def cmd_messages():
    """获取完整消息上下文"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/{session_id}/messages", headers=headers())
    if resp.status_code != 200:
        print(f"[FAIL] Get failed: {resp.text}")
        return

    data = resp.json()
    print(f"Session ID: {data['id']}")
    print(f"Messages:   {len(data['messages'])}")
    print()
    for i, msg in enumerate(data["messages"]):
        role = msg["role"].upper()
        content = msg.get("content", "") or ""
        # For tool role messages, also show the tool name
        if role == "TOOL":
            tool_name = msg.get("name", "unknown")
            preview = content[:150] + "..." if len(content) > 150 else content
            print(f"[{i}] {Colors.GREEN}TOOL ({tool_name}){Colors.RESET}: {preview}")
        elif role == "ASSISTANT":
            # Show tool_calls if present
            tool_calls = msg.get("tool_calls", [])
            content_preview = content[:100] + "..." if len(content) > 100 else content
            if tool_calls:
                tc_names = [tc["name"] for tc in tool_calls]
                print(f"[{i}] {Colors.YELLOW}ASSISTANT{Colors.RESET}: {content_preview} [calls: {', '.join(tc_names)}]")
            else:
                print(f"[{i}] {Colors.YELLOW}ASSISTANT{Colors.RESET}: {content_preview}")
        else:
            preview = content[:100] + "..." if len(content) > 100 else content
            print(f"[{i}] {role}: {preview}")


def cmd_export():
    """导出会话"""
    if not session_id or not session_token:
        print("[FAIL] Please create session first (command: create)")
        return

    resp = requests.get(f"{BASE_URL}/api/session/export/{session_id}", headers=headers())
    if resp.status_code != 200:
        print(f"[FAIL] Export failed: {resp.text}")
        return

    filename = f"session-{session_id}.json"
    with open(filename, "w", encoding="utf-8") as f:
        f.write(resp.text)
    print(f"[OK] Exported to {filename}")


def cmd_import(path: str):
    """导入会话"""
    try:
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"[FAIL] File not found: {path}")
        return
    except json.JSONDecodeError:
        print(f"[FAIL] Invalid JSON file: {path}")
        return

    resp = requests.post(
        f"{BASE_URL}/api/session/import",
        headers={"Content-Type": "application/json"},
        json={"messages": data.get("messages", [])},
    )

    if resp.status_code != 201:
        print(f"[FAIL] Import failed: {resp.text}")
        return

    result = resp.json()
    global session_id, session_token
    session_id = result["id"]
    session_token = result["token"]
    save_session()
    print(f"[OK] Import successful")
    print(f"  New ID:    {session_id}")
    print(f"  New Token: {session_token}")
    print(f"  Messages:  {result['messageCount']}")


def cmd_status():
    """当前会话状态"""
    if not session_id or not session_token:
        print("[INFO] No active session")
    else:
        print(f"Session ID: {session_id}")
        print(f"Token:      {session_token}")


def cmd_help():
    """帮助信息"""
    print("""
EnderRealm Assistant Agent - 测试脚本 (ReAct Agent)

命令:
  create              创建新会话
  chat <message>      发送消息
  info                查看会话信息
  messages            查看消息列表
  export              导出会话到文件
  import <path>       从文件导入会话
  status              查看当前会话状态
  help                显示帮助

SSE 事件说明:
  reasoning           AI 的推理过程（思考/决策）
  tool_call           AI 决定调用某个工具
  tool_result         工具执行结果
  final_answer        最终回答
  error               错误信息

示例:
  python test-chat.py create
  python test-chat.py chat 钻石有什么用？
  python test-chat.py info
  python test-chat.py messages
  python test-chat.py export

交互模式:
  直接输入文字发送消息
  输入 q 退出
  输入 help 查看帮助
""")


def main():
    global session_id, session_token

    # Load existing session from file
    load_session()

    if len(sys.argv) < 2:
        # 交互模式
        print("EnderRealm Assistant Agent - 交互模式 (ReAct Agent)")
        print("输入 q 退出，输入 help 查看帮助")
        cmd_help()

        while True:
            try:
                cmd = input("\n> ").strip()
            except (EOFError, KeyboardInterrupt):
                print("\n退出")
                break

            if not cmd:
                continue

            if cmd.lower() == "q":
                print("退出")
                break

            if cmd.lower() == "help":
                cmd_help()
                continue

            if cmd.lower() == "create":
                cmd_create()
                continue

            if cmd.lower() == "new":
                clear_session()
                cmd_create()
                continue

            if cmd.lower() == "info":
                cmd_info()
                continue

            if cmd.lower() == "messages":
                cmd_messages()
                continue

            if cmd.lower() == "export":
                cmd_export()
                continue

            if cmd.lower() == "status":
                cmd_status()
                continue

            if cmd.lower().startswith("import "):
                path = cmd[7:].strip()
                cmd_import(path)
                continue

            if cmd.lower() == "chat":
                print("用法: chat <message>")
                continue

            # 其他情况当作用户消息发送
            cmd_chat(cmd)
    else:
        # 单命令模式
        cmd = sys.argv[1].lower()

        if cmd.lower() == "create":
            cmd_create()
        elif cmd.lower() == "new":
            clear_session()
            cmd_create()
        elif cmd == "info":
            cmd_info()
        elif cmd == "messages":
            cmd_messages()
        elif cmd == "export":
            cmd_export()
        elif cmd == "status":
            cmd_status()
        elif cmd == "help":
            cmd_help()
        elif cmd == "chat":
            if len(sys.argv) < 3:
                print("用法: chat <message>")
            else:
                cmd_chat(" ".join(sys.argv[2:]))
        elif cmd.startswith("import "):
            path = cmd[7:].strip()
            if not path and len(sys.argv) >= 3:
                path = sys.argv[2]
            cmd_import(path)
        else:
            # 当作用户消息
            cmd_chat(" ".join(sys.argv[1:]))


if __name__ == "__main__":
    main()