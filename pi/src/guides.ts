/**
 * Where a person gets the key for each provider Amuse can set up with one: the
 * page to sign up or sign in at, and the page where keys are made. Data only;
 * the app words the steps itself, the same for every provider. Checked against
 * the web by `scripts/check-provider-guides.ts`.
 */

/** Why a provider needs more than "create a key" (the app has the words for each). */
export type GuideNote =
  /** the account needs credit or billing before a key works */
  | "prepaid"
  /** a mainland China account or phone number is needed */
  | "china"
  /** a console of its own for one region; the account of the other region does not carry over */
  | "region"
  /** a paid plan or subscription comes first */
  | "subscription"
  /** several values, or steps beyond one key page: see `docs` */
  | "complex";

export const guideNotes: readonly GuideNote[] = ["prepaid", "china", "region", "subscription", "complex"];

export interface Guide {
  /** where to sign up or sign in */
  home: string;
  /** the page where keys are created, as deep as stays put */
  keys: string;
  /** the provider's own setup guide, when it is more than one key page */
  docs?: string;
  note?: GuideNote;
}

/** By provider id: the model providers Pi takes an API key for, the voice services, and the apps' key. */
export const guides: Record<string, Guide> = {
  "amazon-bedrock": { home: "https://console.aws.amazon.com/bedrock/", keys: "https://console.aws.amazon.com/bedrock/home#/api-keys", docs: "https://docs.aws.amazon.com/bedrock/latest/userguide/api-keys.html", note: "complex" },
  "ant-ling": { home: "https://chat.ant-ling.com/open", keys: "https://chat.ant-ling.com/open", docs: "https://developer.ant-ling.com/en/docs/getting-started/prerequisites/", note: "china" },
  anthropic: { home: "https://platform.claude.com/", keys: "https://platform.claude.com/settings/keys", note: "prepaid" },
  azure: { home: "https://ai.azure.com/", keys: "https://portal.azure.com/#view/Microsoft_Azure_ProjectOxford/CognitiveServicesHub/~/OpenAI", docs: "https://learn.microsoft.com/azure/ai-services/openai/quickstart", note: "complex" },
  baseten: { home: "https://app.baseten.co/", keys: "https://app.baseten.co/settings/api_keys" },
  cerebras: { home: "https://cloud.cerebras.ai/", keys: "https://cloud.cerebras.ai/" },
  "cloudflare-ai-gateway": { home: "https://dash.cloudflare.com/", keys: "https://dash.cloudflare.com/profile/api-tokens", docs: "https://developers.cloudflare.com/ai-gateway/", note: "complex" },
  "cloudflare-workers-ai": { home: "https://dash.cloudflare.com/", keys: "https://dash.cloudflare.com/profile/api-tokens", docs: "https://developers.cloudflare.com/workers-ai/get-started/rest-api/", note: "complex" },
  composio: { home: "https://dashboard.composio.dev/", keys: "https://dashboard.composio.dev/" },
  deepseek: { home: "https://platform.deepseek.com/", keys: "https://platform.deepseek.com/api_keys", note: "prepaid" },
  fireworks: { home: "https://fireworks.ai/", keys: "https://app.fireworks.ai/settings/users/api-keys" },
  "github-copilot": { home: "https://github.com/settings/copilot", keys: "https://github.com/settings/personal-access-tokens/new", docs: "https://docs.github.com/copilot", note: "complex" },
  google: { home: "https://aistudio.google.com/", keys: "https://aistudio.google.com/apikey" },
  "google-vertex": { home: "https://console.cloud.google.com/vertex-ai", keys: "https://console.cloud.google.com/apis/credentials", docs: "https://cloud.google.com/vertex-ai/generative-ai/docs/start/api-keys", note: "complex" },
  groq: { home: "https://console.groq.com/", keys: "https://console.groq.com/keys" },
  huggingface: { home: "https://huggingface.co/", keys: "https://huggingface.co/settings/tokens" },
  "kimi-coding": { home: "https://www.kimi.com/code", keys: "https://www.kimi.com/code/console", note: "subscription" },
  meta: { home: "https://dev.meta.ai/", keys: "https://dev.meta.ai/", note: "prepaid" },
  minimax: { home: "https://platform.minimax.io/", keys: "https://platform.minimax.io/console/access", note: "region" },
  "minimax-cn": { home: "https://platform.minimax.cn/", keys: "https://platform.minimax.cn/console/access", note: "china" },
  mistral: { home: "https://console.mistral.ai/", keys: "https://console.mistral.ai/api-keys" },
  moonshotai: { home: "https://platform.kimi.ai/", keys: "https://platform.kimi.ai/console/api-keys", note: "prepaid" },
  "moonshotai-cn": { home: "https://platform.kimi.com/", keys: "https://platform.kimi.com/console/api-keys", note: "china" },
  nvidia: { home: "https://build.nvidia.com/", keys: "https://build.nvidia.com/settings/api-keys" },
  openai: { home: "https://platform.openai.com/", keys: "https://platform.openai.com/api-keys", note: "prepaid" },
  opencode: { home: "https://opencode.ai/auth", keys: "https://opencode.ai/auth", note: "prepaid" },
  "opencode-go": { home: "https://opencode.ai/auth", keys: "https://opencode.ai/auth", note: "subscription" },
  openrouter: { home: "https://openrouter.ai/", keys: "https://openrouter.ai/settings/keys" },
  "qwen-token-plan": { home: "https://modelstudio.console.alibabacloud.com/", keys: "https://modelstudio.console.alibabacloud.com/", docs: "https://www.alibabacloud.com/help/en/model-studio/token-plan-team-quickstart", note: "subscription" },
  "qwen-token-plan-cn": { home: "https://bailian.console.aliyun.com/", keys: "https://bailian.console.aliyun.com/", docs: "https://help.aliyun.com/en/model-studio/token-plan-team-overview", note: "china" },
  "qwen-token-plan-individual": { home: "https://modelstudio.console.alibabacloud.com/", keys: "https://modelstudio.console.alibabacloud.com/", docs: "https://www.alibabacloud.com/help/en/model-studio/token-plan-personal-quick-start", note: "subscription" },
  radius: { home: "https://radius.earendil.com/enter", keys: "https://radius.earendil.com/enter", docs: "https://radius.earendil.com/docs" },
  together: { home: "https://api.together.ai/", keys: "https://api.together.ai/settings/api-keys" },
  typesafe: { home: "https://console.typesafe.ai/", keys: "https://console.typesafe.ai/keys" },
  "vercel-ai-gateway": { home: "https://vercel.com/ai-gateway", keys: "https://vercel.com/~/ai-gateway/api-keys" },
  xai: { home: "https://console.x.ai/", keys: "https://console.x.ai/", note: "prepaid" },
  xiaomi: { home: "https://platform.xiaomimimo.com/", keys: "https://platform.xiaomimimo.com/#/console/api-keys" },
  "xiaomi-token-plan-ams": { home: "https://platform.xiaomimimo.com/", keys: "https://platform.xiaomimimo.com/#/console/plan-manage", docs: "https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription", note: "subscription" },
  "xiaomi-token-plan-cn": { home: "https://platform.xiaomimimo.com/", keys: "https://platform.xiaomimimo.com/#/console/plan-manage", docs: "https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription", note: "subscription" },
  "xiaomi-token-plan-sgp": { home: "https://platform.xiaomimimo.com/", keys: "https://platform.xiaomimimo.com/#/console/plan-manage", docs: "https://mimo.mi.com/docs/en-US/tokenplan/Token%20Plan/subscription", note: "subscription" },
  zai: { home: "https://z.ai/model-api", keys: "https://z.ai/manage-apikey/apikey-list", docs: "https://docs.z.ai/devpack/overview", note: "subscription" },
  "zai-coding-cn": { home: "https://open.bigmodel.cn/", keys: "https://open.bigmodel.cn/usercenter/proj-mgmt/apikeys", note: "china" },
};
