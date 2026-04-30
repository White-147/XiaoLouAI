const path = require("path");
const XLSX = require("../.sheettools/node_modules/xlsx");

const FX_USD_CNY = 6.82;
const inputPath = path.join(process.env.USERPROFILE || "C:/Users/Administrator", "Desktop", "模型.xlsx");
const outputPath = path.resolve("模型_整理结果.xlsx");

const HEADERS = [
  "类型",
  "品牌",
  "名称",
  "功能",
  "单价/Mtokens",
  "单价/s",
  "单价/次",
  "单价/首",
  "供应商",
  "开源/闭源",
  "充值方式",
  "说明",
];

function cny(value) {
  return `${(Number(value) * FX_USD_CNY).toFixed(2)}元`;
}

function mtokens(inputUsd, outputUsd) {
  return `输入${cny(inputUsd)}；输出${cny(outputUsd)}`;
}

function row(values = {}) {
  return Object.fromEntries(HEADERS.map((header) => [header, values[header] || ""]));
}

function rangeCny(min, max) {
  return `${cny(min)}-${cny(max)}`;
}

const NOTE_OPENROUTER = "按 OpenRouter 公开 posted price 折算。";
const NOTE_YUNWU = "按云雾公开接入价填写。";
const NOTE_GOOGLE_OFFICIAL = "按 Google 官方公开价填写。";
const NOTE_GOOGLE_FARSTONE =
  "远石科技【官代】官方未查询到模型价格，价格按 Google 官方公开价折算。";
const NOTE_OPEN_SOURCE_LOCAL =
  "支持本地搭建/自部署；0.00元仅表示模型权重免费，不含算力、存储和运维成本。";
const NOTE_XAI = "按 xAI 官方公开 API 价填写。";
const NOTE_ALIYUN = "按阿里云官方公开价填写；部分国际区带免费图片/秒数额度。";
const NOTE_VOLCENGINE = "按火山引擎官方公开接入价填写。";
const NOTE_FUZZY_NAME = "原表名称偏产品名或模糊版本名；精确官方/接入名称见下方新增行。";

const PAY_OPENROUTER =
  "Credits 预充值或自动补款；入口：OpenRouter Credits / Billing；不是会员制。";
const PAY_YUNWU =
  "余额充值后按量扣费；入口：yunwu.ai/topup；另有 free.yunwu.ai 免费额度页；不是会员制。";
const PAY_GOOGLE =
  "按 Google 官方公开口径为 Billing Account / Vertex AI PayGo 按量扣费；不是会员制，也可采购 Provisioned Throughput。";
const PAY_OPEN_SOURCE_LOCAL =
  "无需官方充值；可本地自部署，成本来自 GPU、存储、带宽与运维。";
const PAY_XAI =
  "支持 Prepaid credits 预充值；企业也可申请 Monthly invoiced billing（月结）。";
const PAY_ALIYUN =
  "阿里云百炼 / Model Studio 账户开通后按量扣费，可走余额或绑定支付方式；不是会员制。";
const PAY_VOLCENGINE =
  "火山引擎 Ark 账户开通并绑定支付方式后按量扣费；不是会员制。";
const PAY_SUNO =
  "会员制为主，不是公开开发者 API 预充值。入口：Suno Pricing / Subscription。Free 50 credits/日；Pro $8/月 = 2500 credits；Premier $24/月 = 10000 credits；付费后还能 Buy More Credits。";
const PAY_STABLE_AUDIO =
  "官网订阅 + track credits；入口：Stable Audio Pricing。Free 10 tracks/月；付费档 Pro / Studio / Max；不是公开开发者 API 按量充值。";
const PAY_NETEASE =
  "公开资料未见开发者 API 充值入口；当前更像创作平台使用，会员/点数规则未公开。";
const PAY_TME =
  "公开资料未见开发者 API 充值入口；当前更像创作平台使用，会员/点数规则未公开。";
const PAY_BYTE_MUSIC =
  "公开资料未见商用 API 充值入口与稳定计费页；当前更像研究/产品能力展示，无法确认是会员制还是点数制。";
const PAY_HAPPYHORSE =
  "官方公开充值入口与稳定 API 计费页暂未检索到，当前更像内测阶段。";
const PAY_VIDU =
  "按 credits 充值；入口：platform.vidu.com Billing；1 credit = $0.005；不是会员制。站内另有面向创作者的套餐，但 API 接入以 credits 计费为主。";
const PAY_SKYREELS =
  "官方公开充值入口与 API 计费尚未发布；如需接入，当前只能优先关注 APIMart 等接入中平台。";
const PAY_PIXVERSE =
  "支持两条路：1）直接买 credits，入口：PixVerse API Billing / Buy Credits，公开档 $10 / $50 / $100 / $500 / $2000 / $5000；2）API Memberships，公开档 Free / Essential($100/月) / Scale($1500/月) / Business($6000/月)。API Membership 与 Web 会员分离，且可叠加额外买 credits。";
const PAY_HAILUO =
  "支持 Token Plan、Video Packages 与 Pay as You Go。公开视频包档位：Standard $1000/月、Pro $2500/月、Scale $4500/月、Business $6000/月；另有 Token Plan Max 含少量视频额度。";
const PAY_MIDJOURNEY =
  "官方只支持会员订阅，不提供公开开发者 API 充值。公开档 Basic / Standard / Pro / Mega = $10 / $30 / $60 / $120 月付，年付约 8 折；接口化通常只能走中转。";
const PAY_KLING =
  "官方公开 API 按 Credits/s 扣费；需开通账户后设置计费。公开规则可见 Native Audio 12/9 Credits/s、No Native Audio 8/6 Credits/s、Voice Control 另加 2 Credits/s；公开 API 会员档价未稳定检索到。";
const PAY_FUZZY = "原名称模糊，充值方式见下方新增精确型号行。";

const exactUpdates = {
  "Claude Opus 4.6": row({
    功能: "文本+图像输入，对话输出，支持工具调用、缓存与长上下文。",
    "单价/Mtokens": mtokens(5, 25),
    供应商: "OpenRouter",
    "开源/闭源": "闭源",
    说明: NOTE_OPENROUTER,
  }),
  "GPT - 5.4": row({
    功能: "文本/图像/文件输入，对话输出，支持工具与 Web Search。",
    "单价/Mtokens": mtokens(2.5, 15),
    供应商: "OpenRouter",
    "开源/闭源": "闭源",
    说明: NOTE_OPENROUTER,
  }),
  "Grok 4.1": row({
    功能: "文本+识图+联网，对话输出，偏搜索与实时信息场景。",
    "单价/Mtokens": mtokens(2, 10),
    供应商: "云雾",
    "开源/闭源": "闭源",
    说明: NOTE_YUNWU,
  }),
  "Kimi K2.5": row({
    功能: "文本/视觉输入，支持思考与 Agent 任务。",
    "单价/Mtokens": mtokens(4, 21),
    供应商: "云雾",
    "开源/闭源": "闭源",
    说明: NOTE_YUNWU,
  }),
  "Suno V4": row({
    功能: "文生音乐，支持歌词、人声、风格控制。",
    "单价/首": cny(8 / 500),
    供应商: "Suno官网",
    "开源/闭源": "闭源",
    说明:
      "官网主要面向站内创作，不是标准公开开发者 API；本表单价/首按 Pro 月付折算。若一定要接口化，可关注 SunoAPI.org 这类中转。",
  }),
  "Stable Audio 2.0": row({
    功能: "文生音乐/音效，支持商用授权与企业部署沟通。",
    "单价/首": "未公开",
    供应商: "Stable Audio官网",
    "开源/闭源": "闭源",
    说明:
      "官网公开的是订阅口径而非公开 API 单首定价，因此本表保留“未公开”；企业私有部署需联系销售。",
  }),
  "网易天音 3.0": row({
    功能: "中文歌曲创作、编曲与歌声合成。",
    "单价/首": "未公开",
    供应商: "网易天音官网",
    "开源/闭源": "闭源",
    说明: "目前检索到的公开信息更偏创作平台入口，未见公开开发者 API 文档与按首计价页；暂未发现稳定公开中转站。",
  }),
  "TME Music 2.0": row({
    功能: "AI 作曲/编曲/歌声生成。",
    "单价/首": "未公开",
    供应商: "腾讯音乐官网",
    "开源/闭源": "闭源",
    说明: "目前检索到的公开信息更偏 TME Studio 创作平台，未见公开开发者 API 文档与按首计价页；暂未发现稳定公开中转站。",
  }),
  "Flux 1.1 Dev": row({
    功能: "文生图，适合实验和自部署；官方开放权重，可单独接入。",
    "单价/次": "0.00元",
    供应商: "Black Forest Labs官网",
    "开源/闭源": "开源",
    说明: NOTE_OPEN_SOURCE_LOCAL,
  }),
  "Stable Diffusion 3.5": row({
    功能: "文生图/图生图，提示词遵循强，官方开放权重，可自部署。",
    "单价/次": "0.00元",
    供应商: "Stability AI官网",
    "开源/闭源": "开源",
    说明: NOTE_OPEN_SOURCE_LOCAL,
  }),
  "HappyHorse - 1.0": row({
    功能: "公开视频生成模型，公开稳定接入资料较少。",
    "单价/s": "未公开",
    供应商: "官网（内测）",
    "开源/闭源": "闭源",
    说明:
      "2026-04-10 的公开报道显示 HappyHorse 仍处 internal beta，API 被描述为“即将推出”；当前未见可信官方公开 API 文档与计价页，因此先不按正式公开模型写价。",
  }),
  "Seedance 2.0": row({
    功能: "单参/多参/首尾帧；720p/480p，4-15s，支持多画幅。",
    "单价/s": "1.00元",
    供应商: "火山引擎官网",
    "开源/闭源": "闭源",
    说明: "当前表内单价按火山引擎已公开接入价折算。",
  }),
  "Vidu Q3": row({
    功能: "单参/多参，支持文生视频、图生视频、首尾帧视频；540p/720p/1080p。",
    "单价/s": rangeCny(0.05, 0.15),
    供应商: "Vidu官网",
    "开源/闭源": "闭源",
    说明:
      "本表按公开的 Q3-Pro 540P/720P/1080P 秒价折算，另有 Off-peak 低价档。",
  }),
  "SkyReels V4": row({
    功能: "视频+音频同生；支持文/图/视频/音频参考，最高 1080p 32FPS，最长 15s。",
    "单价/s": "未公开",
    供应商: "APIMart（接入中）",
    "开源/闭源": "闭源",
    说明:
      "Skywork 公开仓库已开源 SkyReels V1/V3，但 SkyReels V4 当前公开的是论文与 demo；APIMart 页面显示 API 集成进行中、价格尚未发布。若只能走中转，当前优先关注 APIMart。",
  }),
  "PixVerse V6": row({
    功能: "单参/首尾帧；1-15s，360p/540p/720p/1080p，支持原生音频。",
    "单价/s": rangeCny(0.045, 0.115),
    供应商: "PixVerse官网",
    "开源/闭源": "闭源",
    说明: "V6 视频本身按秒计费，本表单价按官方公开 API 计费口径折算。",
  }),
  "Hailuo 2.3": row({
    功能: "文生视频/图生视频，写实动态更强，支持 768p/1080p 常用档位。",
    "单价/s": rangeCny(0.10 / 6, 0.56 / 10),
    供应商: "MiniMax官网",
    "开源/闭源": "闭源",
    说明:
      "公开视频定价同时存在 Token 与视频包两种口径，本表按公开视频档位折算到秒价。",
  }),
  "LTX - 2.3": row({
    功能: "开放权重视频生成，可自部署；原表型号为系列名。",
    "单价/s": "0.00元",
    供应商: "Lightricks官网",
    "开源/闭源": "开源",
    说明: NOTE_OPEN_SOURCE_LOCAL,
  }),
  "AnimateDiff V3": row({
    功能: "图像动画/文生短视频，社区生态成熟，可自部署。",
    "单价/s": "0.00元",
    供应商: "开源社区",
    "开源/闭源": "开源",
    说明: NOTE_OPEN_SOURCE_LOCAL,
  }),
  "Zeroscope V2": row({
    功能: "文生短视频，偏基础镜头与开放工作流，可自部署。",
    "单价/s": "0.00元",
    供应商: "开源社区",
    "开源/闭源": "开源",
    说明: NOTE_OPEN_SOURCE_LOCAL,
  }),
  "Gemini 3.1 Pro": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "DeepSeek V4": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Qwen 3.5": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "豆包 5.0 Pro": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Gemini Music 3.0": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "ByteMusic 2.0": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Gemini Nano Banana 2": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Gemini Nano Banana Pro": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Wan 2.7 - Image Pro": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "GPT - Image 1.5": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Seedream 5.0 Pro": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Midjourney V7": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Grok - 2 Vision": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Kling 3.0": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Grok Imagine Video": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Veo 3.1": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Veo 3.1 - Fast": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Veo 3.1 - Lite": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Veo 3.1 - 4K": row({
    说明: NOTE_FUZZY_NAME,
  }),
  "Wan 2.7 - Video": row({
    说明: NOTE_FUZZY_NAME,
  }),
};

const insertsAfter = {
  "Gemini 3.1 Pro": [
    row({
      类型: "对话模型",
      品牌: "Google",
      名称: "Gemini 3.1 Pro Preview",
      功能: "原生多模态，适合复杂推理、编码与代理任务。",
      "单价/Mtokens": mtokens(2, 12),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "对话模型",
      品牌: "Google",
      名称: "Gemini 3.1 Pro Preview",
      功能: "原生多模态，适合复杂推理、编码与代理任务。",
      "单价/Mtokens": mtokens(2, 12),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "DeepSeek V4": [
    row({
      类型: "对话模型",
      品牌: "深度求索",
      名称: "DeepSeek-V3.2",
      功能: "文本对话，支持工具调用；官方当前主线版本。",
      "单价/Mtokens": mtokens(2, 3),
      供应商: "云雾",
      "开源/闭源": "开源",
      说明: `${NOTE_YUNWU} 模型本身可自部署。`,
    }),
  ],
  "Qwen 3.5": [
    row({
      类型: "对话模型",
      品牌: "阿里通义千问",
      名称: "Qwen3.5-Plus",
      功能: "原生多模态，对话/识图/推理兼顾。",
      "单价/Mtokens": mtokens(0.8, 4.8),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
  ],
  "豆包 5.0 Pro": [
    row({
      类型: "对话模型",
      品牌: "字节跳动",
      名称: "Doubao-Seed-2.0-pro-260215",
      功能: "长上下文、多模态理解、复杂工具执行。",
      "单价/Mtokens": mtokens(3.2, 16),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
  ],
  "Gemini Music 3.0": [
    row({
      类型: "音乐模型",
      品牌: "Google",
      名称: "Lyria 3 短片预览版（30秒）",
      功能: "文生音乐短片，单首计价。",
      "单价/首": cny(0.03),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
    row({
      类型: "音乐模型",
      品牌: "Google",
      名称: "Lyria 3 Pro 预览版（完整歌曲）",
      功能: "文生完整歌曲，单首计价。",
      "单价/首": cny(0.05),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "ByteMusic 2.0": [
    row({
      类型: "音乐模型",
      品牌: "字节跳动",
      名称: "Seed Music",
      功能: "文生音乐/旋律延展。",
      "单价/首": "未公开",
      供应商: "字节官网",
      "开源/闭源": "闭源",
      说明: "目前检索到的是官方研究/产品信息，未见公开商用 API 定价页；更像研究/产品能力，不适合按公开接口价写入，暂未发现稳定公开中转站。",
    }),
  ],
  "Gemini Nano Banana 2": [
    row({
      类型: "图像模型",
      品牌: "Google",
      名称: "Gemini 3.1 Flash Image Preview",
      功能: "单参/多参，最多14张参考图；1K/2K/4K，支持10种画幅。",
      "单价/次": cny(0.1655),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "图像模型",
      品牌: "Google",
      名称: "Gemini 2.5 Flash Image",
      功能: "单参/多参，最多14张参考图；1K/2K，支持10种画幅。",
      "单价/次": rangeCny(0.045, 0.151),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "Gemini Nano Banana Pro": [
    row({
      类型: "图像模型",
      品牌: "Google",
      名称: "Gemini 3 Pro Image Preview",
      功能: "单参/多参，最多14张参考图；1K/2K/4K，支持10种画幅。",
      "单价/次": cny(0.33),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "图像模型",
      品牌: "Google",
      名称: "Gemini 3 Pro Image Preview",
      功能: "单参/多参，最多14张参考图；1K/2K/4K，支持10种画幅。",
      "单价/次": rangeCny(0.134, 0.24),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "Wan 2.7 - Image Pro": [
    row({
      类型: "图像模型",
      品牌: "阿里通义万相",
      名称: "wan2.6-image",
      功能: "通用图像生成/编辑；官方公开可计费型号，按张计费。",
      "单价/次": cny(0.028671),
      供应商: "阿里云官网",
      "开源/闭源": "闭源",
      说明: `${NOTE_ALIYUN} 原表“Wan 2.7 - Image Pro”未在公开价目中检索到，当前最接近且可公开计费的官方型号是 wan2.6-image。`,
    }),
  ],
  "GPT - Image 1.5": [
    row({
      类型: "图像模型",
      品牌: "OpenAI",
      名称: "GPT-5 Image",
      功能: "文本生图、图像编辑；文本/图片输入，图片输出。",
      "单价/Mtokens": mtokens(10, 10),
      供应商: "OpenRouter",
      "开源/闭源": "闭源",
      说明: "原表“GPT-Image 1.5”未在 OpenRouter 模型目录直出；当前接口化更精确的公开模型名是 GPT-5 Image。",
    }),
  ],
  "Seedream 5.0 Pro": [
    row({
      类型: "图像模型",
      品牌: "字节跳动",
      名称: "Doubao-Seedream-5.0-260128",
      功能: "单参/多参；2K/3K，支持8种画幅，最多4张参考图。",
      "单价/次": cny(0.22),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
  ],
  "Midjourney V7": [
    row({
      类型: "图像模型",
      品牌: "Midjourney Inc.",
      名称: "mj_imagine",
      功能: "文生图主生成接口；局部重绘、变体、放大需分步调用。",
      "单价/次": cny(0.3),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: "Midjourney 官方没有公开开发者 API；当前如需接口接入，推荐继续走云雾这类稳定中转。",
    }),
  ],
  "Grok - 2 Vision": [
    row({
      类型: "图像模型",
      品牌: "xAI",
      名称: "grok-2-vision-1212",
      功能: "文本+图像输入，对话输出，视觉理解与分析。",
      "单价/Mtokens": mtokens(2, 10),
      供应商: "xAI官网",
      "开源/闭源": "闭源",
      说明: NOTE_XAI,
    }),
  ],
  "Kling 3.0": [
    row({
      类型: "视频模型",
      品牌: "快手",
      名称: "kling-video",
      功能: "单参/多参/续写；3-15s，支持文生视频、图生视频、首尾帧与原生音频。",
      "单价/s": rangeCny(0.03, 0.07),
      供应商: "Kling官网",
      "开源/闭源": "闭源",
      说明: "当前公开页可稳定检索到的是 API 秒价规则，面向 API 的完整商业档位说明仍不完整。",
    }),
  ],
  "Grok Imagine Video": [
    row({
      类型: "视频模型",
      品牌: "xAI",
      名称: "grok-video-3",
      功能: "单参，支持文生视频/图生视频。",
      "单价/s": cny(0.4),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: "当前表内经云雾接入；xAI 已发布 Grok Imagine API 入口信息，但公开稳定计价页未像文本模型那样完整展开。",
    }),
  ],
  "Veo 3.1": [
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1",
      功能: "单参/首尾帧，支持文生视频与图生视频。",
      "单价/s": cny(0.7),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1",
      功能: "单参/首尾帧，支持文生视频与图生视频。",
      "单价/s": rangeCny(0.4, 0.6),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "Veo 3.1 - Fast": [
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1 Fast",
      功能: "单参/首尾帧，偏速度优先。",
      "单价/s": cny(0.7),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1 Fast",
      功能: "单参/首尾帧，偏速度优先。",
      "单价/s": rangeCny(0.1, 0.3),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "Veo 3.1 - Lite": [
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1 Lite",
      功能: "单参/首尾帧，轻量价位。",
      "单价/s": cny(0.5),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1 Lite",
      功能: "单参/首尾帧，轻量价位。",
      "单价/s": rangeCny(0.05, 0.08),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "Veo 3.1 - 4K": [
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1 4K",
      功能: "单参/首尾帧，4K 档位。",
      "单价/s": cny(0.85),
      供应商: "云雾",
      "开源/闭源": "闭源",
      说明: NOTE_YUNWU,
    }),
    row({
      类型: "视频模型",
      品牌: "Google",
      名称: "Veo 3.1 4K",
      功能: "单参/首尾帧，4K 档位。",
      "单价/s": cny(0.6),
      供应商: "远石科技【官代】",
      "开源/闭源": "闭源",
      说明: NOTE_GOOGLE_FARSTONE,
    }),
  ],
  "Wan 2.7 - Video": [
    row({
      类型: "视频模型",
      品牌: "阿里通义千问",
      名称: "wan2.6-i2v",
      功能: "单参/多镜头叙事，支持自动配音和自定义音频。",
      "单价/s": rangeCny(0.086012, 0.143353),
      供应商: "阿里云官网",
      "开源/闭源": "闭源",
      说明: `${NOTE_ALIYUN} 原表“Wan 2.7 - Video”未在公开价目中检索到，当前最接近且可公开计费的官方型号是 wan2.6-i2v。`,
    }),
  ],
};

const notes = [
  ["填表说明", ""],
  ["汇率", `统一按 1 USD = ${FX_USD_CNY.toFixed(2)} CNY 折算。`],
  ["Google 官代说明", "所有“远石科技【官代】”行统一说明为：远石科技【官代】官方未查询到模型价格，价格按 Google 官方公开价折算。"],
  ["充值方式列", "充值方式列优先写清：按量扣费、credits/token 预充值、会员订阅、月结、无官方充值入口，或仅能本地搭建。"],
  ["说明列范围", "说明列只补充不与充值方式重复的信息：价格口径、是否无公开 API、是否只能走中转、是否仅适合本地自部署等。"],
  ["音乐模型", "若官网只能按会员/credits 计，不按每首公开计价，充值方式列会写会员档位与入口；单价/首仅在可合理折算时填写。"],
  ["开源模型", "开源模型的 0.00 元仅表示模型权重免费，不含 GPU、存储、带宽与运维成本。"],
];

function inferPaymentMethod(item) {
  const name = item["名称"] || "";
  const supplier = item["供应商"] || "";
  const note = item["说明"] || "";
  const isOpenSource = item["开源/闭源"] === "开源";

  if (item["充值方式"]) return item["充值方式"];
  if (note === NOTE_FUZZY_NAME) return PAY_FUZZY;

  if (name === "Suno V4") return PAY_SUNO;
  if (name === "Stable Audio 2.0") return PAY_STABLE_AUDIO;
  if (name === "网易天音 3.0") return PAY_NETEASE;
  if (name === "TME Music 2.0") return PAY_TME;
  if (name === "Seed Music") return PAY_BYTE_MUSIC;
  if (name === "HappyHorse - 1.0") return PAY_HAPPYHORSE;
  if (name === "Vidu Q3") return PAY_VIDU;
  if (name === "SkyReels V4") return PAY_SKYREELS;
  if (name === "PixVerse V6") return PAY_PIXVERSE;
  if (name === "Hailuo 2.3") return PAY_HAILUO;
  if (name === "mj_imagine" || name === "Midjourney V7") return PAY_MIDJOURNEY;
  if (name === "kling-video" || name === "Kling 3.0") return PAY_KLING;

  if (supplier === "OpenRouter") return PAY_OPENROUTER;
  if (supplier === "云雾") return PAY_YUNWU;
  if (supplier === "远石科技【官代】") return PAY_GOOGLE;
  if (supplier === "xAI官网") return PAY_XAI;
  if (supplier === "阿里云官网") return PAY_ALIYUN;
  if (supplier === "火山引擎官网") return PAY_VOLCENGINE;
  if (supplier === "Vidu官网") return PAY_VIDU;
  if (supplier === "PixVerse官网") return PAY_PIXVERSE;
  if (supplier === "MiniMax官网") return PAY_HAILUO;
  if (supplier === "Suno官网") return PAY_SUNO;
  if (supplier === "Stable Audio官网") return PAY_STABLE_AUDIO;
  if (supplier === "网易天音官网") return PAY_NETEASE;
  if (supplier === "腾讯音乐官网") return PAY_TME;
  if (supplier === "字节官网") return PAY_BYTE_MUSIC;
  if (supplier === "Kling官网") return PAY_KLING;
  if (supplier === "APIMart（接入中）") return PAY_SKYREELS;
  if (supplier === "官网（内测）") return PAY_HAPPYHORSE;
  if (isOpenSource || supplier === "Black Forest Labs官网" || supplier === "Stability AI官网" || supplier === "Lightricks官网" || supplier === "开源社区") {
    return PAY_OPEN_SOURCE_LOCAL;
  }

  return "";
}

function finalizeRow(item) {
  const current = { ...item };
  current["充值方式"] = inferPaymentMethod(current);
  return current;
}

function loadSourceRows() {
  const workbook = XLSX.readFile(inputPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" });
  const headers = matrix[1];
  const dataRows = matrix.slice(2);

  let lastType = "";
  let lastBrand = "";

  return dataRows.map((cells) => {
    const item = {};
    headers.forEach((header, index) => {
      item[header] = cells[index] ?? "";
    });

    if (item["品牌"] === "Stable Audio 2.0" && item["名称"] === "Stability AI") {
      item["品牌"] = "Stability AI";
      item["名称"] = "Stable Audio 2.0";
    }

    if (item["类型"]) lastType = item["类型"];
    else item["类型"] = lastType;

    if (item["品牌"]) lastBrand = item["品牌"];
    else item["品牌"] = lastBrand;

    return item;
  });
}

function buildOutputRows(sourceRows) {
  const result = [];

  for (const sourceRow of sourceRows) {
    const name = sourceRow["名称"];
    const current = row({
      类型: sourceRow["类型"],
      品牌: sourceRow["品牌"],
      名称: sourceRow["名称"],
      功能: sourceRow["功能"],
      "单价/Mtokens": sourceRow["单价/Mtokens"],
      "单价/s": sourceRow["单价/s"],
      "单价/次": sourceRow["单价/次"],
      "单价/首": "",
      供应商: sourceRow["供应商"],
      "开源/闭源": sourceRow["开源/闭源"],
      充值方式: "",
      说明: "",
    });

    if (exactUpdates[name]) {
      Object.assign(current, exactUpdates[name]);
      current.类型 = current.类型 || sourceRow["类型"];
      current.品牌 = current.品牌 || sourceRow["品牌"];
      current.名称 = current.名称 || sourceRow["名称"];
    }

    result.push(finalizeRow(current));

    if (insertsAfter[name]) {
      result.push(...insertsAfter[name].map(finalizeRow));
    }
  }

  return result;
}

function buildSheetRows(outputRows) {
  const matrix = [HEADERS, ...outputRows.map((item) => HEADERS.map((header) => item[header] || "")), []];
  for (const [left, right] of notes) {
    const line = new Array(HEADERS.length).fill("");
    line[0] = left;
    line[1] = right;
    matrix.push(line);
  }
  return matrix;
}

function main() {
  const sourceRows = loadSourceRows();
  const outputRows = buildOutputRows(sourceRows);
  const sheetRows = buildSheetRows(outputRows);
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet(sheetRows);
  sheet["!cols"] = [
    { wch: 12 },
    { wch: 16 },
    { wch: 30 },
    { wch: 42 },
    { wch: 24 },
    { wch: 14 },
    { wch: 14 },
    { wch: 14 },
    { wch: 20 },
    { wch: 12 },
    { wch: 44 },
    { wch: 64 },
  ];
  XLSX.utils.book_append_sheet(workbook, sheet, "模型整理");
  XLSX.writeFile(workbook, outputPath);
  console.log(outputPath);
}

main();
