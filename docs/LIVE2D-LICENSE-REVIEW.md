# Live2D 官方许可引用与选择 / Official license references and opt-in

核查日期 / Checked: 2026-11-08。本文记录工程实现与官方来源，不是法律意见、Live2D 官方模板或充分合规保证。
This records implementation and official sources, not legal advice, an official template or a guarantee of legal sufficiency.

## 官方来源 / Official sources

- [SDK 许可](https://www.live2d.com/en/sdk/license/)与[发行 FAQ](https://help.live2d.com/en/sdk/sdk_001/)：免费发行取决于主体、此前年度整体商业销售额及控制关系，不仅是游戏是否收费。发行者已于2026-11-08确认适用免费资格，未披露具体金额。 / Free eligibility depends on the publisher and prior-year business sales, not merely a free game; the publisher confirmed eligibility without disclosing an amount.
- [扩展型应用](https://www.live2d.com/en/sdk/license/expandable/)另有条件。当前游戏仅有七个固定角色、不支持导入；普通固定角色游戏没有必须先取得官方项目审核的通用要求。此功能判断不等于 Live2D 认证。 / Expandable applications have separate conditions; this fixed-role game has no model import and no identified general requirement for official project prereview. This is not certification.
- Core：[官方中文](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_cn.html)、[官方日文](https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_jp.html)，Proprietary v2.1，2025-02-03 修订。§5.2.2 要求分发者/最终用户同意等同保护条款，并未要求另起一份游戏合同或先获官方审批；§5.2.4 要求原样再分发，§6 保留标识，§15.2 日文解释优先。 / Equivalent protective assent, unchanged Core and notices are required; a separate game contract or official prereview is not specified, and Japanese interpretation prevails.
- Framework：[官方中文](https://www.live2d.com/eula/live2d-open-software-license-agreement_cn.html)、[官方日文](https://www.live2d.com/eula/live2d-open-software-license-agreement_jp.html)，Open Software v1.4，2025-02-03 修订。§2.2.1 涉及指定 runtime 集成后的终端分发；Core 禁改不能套用到 Framework。 / Framework has a distinct license covering integrated runtime distribution; Core restrictions must not erase Framework rights.

## 当前已实施方案 / Implemented approach

发行者选择使用已有官方许可，不启用此前自拟七条协议，不要求账号、付款、收入申报、赔偿承诺或玩家承担开发者所有义务。界面明确限制为本游戏所含组件使用及保护的适用条款，中文全文和日文原文均可打开。本方案不是官方通用模板，也不宣称已获得官方认可。
The publisher chose the existing official licenses, not the earlier seven-clause draft. There is no account/payment/income declaration/indemnity or blanket transfer of developer duties. The UI limits assent to applicable use/protection terms for the included components and links official Chinese and Japanese texts. It is not an official template or certification.

标题：**启用 Live2D 动态角色**。

动态角色使用 Live2D Cubism Core 和 Framework。请阅读 Core 官方许可与 Framework 官方许可。启用时，您同意其中适用于本游戏所含 Live2D 组件使用及保护的条款。您也可以不启用动态角色，继续使用静态角色。

按钮：**同意并启用动态角色** / **不启用，使用静态角色**。

1. 默认静态，设置入口位于 App 页眉下，两种玩法始终可见。打开/关闭设置不算同意，不自动弹窗、不反复催促，不阻挡牌局。 / Static by default, with a persistent nonblocking settings entry for both modes. Merely opening/closing is not assent; no nagging modal blocks play.
2. `CharacterArtwork` 和默认 runtime loader 双重检查；同意前不下载、执行、预取或预缓存 Core、Framework、模型、纹理或 Live2D 背景。 / Both the frame and default runtime loader gate SDK/model/texture/background fetching, execution and prefetch before assent.
3. 仅在本地 `huajian-live2d-consent-v1` 保存 `{version, enabled}`。只恢复当前版本的明确布尔选择，旧版/未知/损坏/不可读记录保持静态；没有身份、时间戳、账号或服务端记录。 / Only the version and boolean are stored locally. Stale/unknown/malformed/unreadable records stay static, with no identity/timestamp/account/server record.
4. 关闭立即失效在途实例并释放模型/纹理、恢复原图；已在同意期间请求或缓存的脚本不可能撤回，但 Core 等待期间撤销会阻止后续 Framework 导入。存储读写失败不影响游戏，页面说明只能保证本页选择；尽力移除无法覆写的旧同意。 / Disabling invalidates pending instances and releases resources. Previously authorized downloads/caches cannot be undone, but withdrawal during Core readiness prevents the subsequent Framework import. Storage failures preserve play and show the page-only limitation.
5. Core6.0.1 / FrameworkR5 的原字节及许可证/版权声明保持完整。界面引用和随包声明各司其职；未来第三方再分发仍须另外遵守适用要求。 / Exact SDK bytes and original notices/licenses remain intact; UI assent and package notices serve different roles, and future third-party distribution has its own requirements.

## 视觉验证与发布决定 / Visual verification and publication decision

实际浏览器普通 WebGL 不可用，`webglVerified=false`。尚未验证 GPU 首帧、连续动态、掩膜边缘或移动端性能。2026-11-08 发行者明确说“我来验收就可以  你先发布”，自愿承担先发布、由其本人验收的风险。这不是 GPU 测试通过，也不再把客服/律师预审批或本机 GPU 验收当成其发布指令之外的强制条件。发布动作仍由拥有授权的发布流程执行；本文实现者不推送/部署。
Ordinary browser WebGL remains unavailable, with graphics and mobile performance unverified. On 2026-11-08 the publisher explicitly chose publication first and personal visual acceptance. This does not turn unrun checks into passes or impose an invented official/legal prereview requirement. Authorized publication remains a separate operation; this implementation worker does not push/deploy.

## 历史草稿状态 / Historical draft status

此前未实施草稿已被本官方引用方案替代，不在 UI、存储版本或玩家同意范围中生效。
The earlier unimplemented draft is superseded by the official-reference approach and is not part of the UI, stored version or player assent.
