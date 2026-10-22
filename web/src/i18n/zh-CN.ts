/**
 * Simplified Chinese. Natural product wording, not word-for-word English.
 * Full-width punctuation; "Amuse" stays as it is.
 *
 * Glossary (use these words everywhere):
 *   Chats 聊天 · Main chat 主聊天 · Side chats 临时对话 · Goals 目标 ·
 *   Skills 技能 · Settings 设置 · General 通用 · Models 模型 ·
 *   Connections 连接 · Connect 连接 · Permissions 权限 ·
 *   Saved logins 已保存的登录 · Schedules 定时任务 · Sandbox 沙箱 ·
 *   Credentials 凭据 · Browser 浏览器 · Terminal 终端 · Take control 接管 ·
 *   Done (handing back) 完成 · Stop 停止 · Activity 动态 · Approvals 审批 ·
 *   Upcoming 即将进行 · Allow once 仅此一次 · Always allow 始终允许 ·
 *   Deny 拒绝 · Allow 允许 · Ask 询问 · Copy 复制 · Share 分享 ·
 *   Message (composer placeholder) 发消息 · Send 发送 · Retry 重试 ·
 *   Paused 已暂停 · Working 进行中 · Waiting for you 等你操作 ·
 *   Completed 已完成 · Failed 失败 · Stopped 已停止 · Ready 就绪 ·
 *   Closed 已关闭 · Password 密码 · Continue 继续 · Lock 锁定
 */
import type { Messages } from "./en.ts";

export const zhCN = {
  settings: {
    language: "语言",
    languageSystem: "跟随系统",
  },
  time: {
    today: (at) => `今天 ${at}`,
    tomorrow: (at) => `明天 ${at}`,
    yesterday: (at) => `昨天 ${at}`,
    onDay: (day, at) => `${day} ${at}`,
  },
  schedule: {
    once: (when) => `仅一次，${when}`,
    everyDayAt: (at) => `每天 ${at}`,
  },
} satisfies Messages;
