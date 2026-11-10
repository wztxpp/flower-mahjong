# 横屏桌验收 / Landscape acceptance

日期：2026-11-10。基线：`544048a7950f1b16e1af0865a0714b8571f682d5`。独立本机展示模式，未推送、合并或部署。
Date: 2026-11-10. Baseline above. This is an independent local presentation, not pushed, merged or deployed.

## 自动检查 / Automated checks

- `npm test`：1734/1734通过，无跳过。新增16项横屏行为/样式回归；邀请测试装载器同步注入既有成都状态模块。 / All1734 pass, none skipped. Sixteen landscape behavior/style regressions were added; the invitation harness now injects the existing Chengdu status dependency.
- `npm run lint`：退出0，0错误，3条基线文件警告（worker默认导出、game的wasRepeat、rob-kong测试的passAll），另有既有Pages目录配置提示。 / Exit0, no errors, three warnings in unchanged files plus the existing Pages-directory configuration notice.
- `npm run build`：退出0。保留既有Three renderer超过500kB提示；不为本次布局改依赖或拆包。 / Exit0; the existing large Three renderer chunk warning remains, without dependency/chunk refactoring.
- `git diff --check`：通过。 / Passed.

测试直接编译App SFC，覆盖经典→横屏→真实→横屏、选牌/会话/权威快照保留、切换零API、详情开关、保存偏好/非法值、成都状态、观众接牌/抢杠及真实桌Teleport隔离。CSS解析确保每个选择器以横屏根类开头。紧凑状态保留polite播报，不抢焦点。
Tests compile the actual App SFC and cover mode round trips, preserved selection/session/authority, zero switch APIs, details, preference restoration, Chengdu status, spectator claims and realistic Teleport isolation. CSS parsing checks every selector's root scope. Compact status retains polite announcements without taking focus.

## 浏览器实测 / Browser measurements

使用隔离Chromium预览的真实iframe视口，App、ChengduTable和CSS均为实际文件；所有姓名/牌面/积分是合成数据。预览原有网络与动作双重封锁不变。原始DOM读数见 [JSON](landscape-table-browser-20261110.json)。
Used actual iframe viewports in isolated Chromium, with shipped components/styles and synthetic data. Existing network/action denial boundaries remained. Raw DOM measurements are linked above.

- 18组尺寸：三人花麻将、四人花麻将、成都四人，各测568×320、667×375、812×375、844×390、932×430、1024×760。全部手牌/动作在视口内，动作带不遮牌，按钮至少44px高，手牌44×56px，无页面横向溢出。 / All18 game/viewport combinations fit private controls without overlap, with44px buttons,44×56px tiles and no page-wide horizontal overflow.
- 18组568×320压力场景：空/普通/增长公开区、多动作、接牌、抢杠、离线、终局、成都换牌/定缺、旧schema1/2及两玩法观众。所有预期手牌和操作几何检查通过，观众私有控件计数为0。 / Eighteen short-screen stress cases covered public growth, actions, claims, offline, terminal, preparation, frozen legacy versions and spectators; expected controls fit and spectators had no private controls.
- 额外复核两玩法观众接牌/抢杠共4组：来源文字和牌面保留，原页脚实际显示40px，均在320px高度内。成都换三张/定缺/回合/接牌的紧凑状态与原帮助一致。 / Four spectator claim/rob-kong cases retain sources/faces in40px footers; Chengdu preparation/turn/claim guidance matches existing wording.
- 568px窄横屏：手牌方向键横滚144px到末端，末张9筒可选。844px下选3条，打开/关闭详情与经典/横屏切换均保留选牌。 / Keyboard scrolling reached the last tile at568px; pointer selection survives detail and mode changes.
- 仅改变视口568×320→390×760→844×390，未替换快照。竖屏出现转向提示，恢复横屏后一屏手牌底部为362px，始终保留9筒选中。 / Viewport-only rotation preserved the selected9-dot tile, showed the portrait hint and restored a fitted landscape hand.
- 844×390合成四人花麻将完成目视检查；详情恢复原规则、积分、记录和完整内容。 / Visually reviewed a synthetic four-player844×390 table and verified details restore the original full document.

## 审阅与限制 / Review and limitations

独立审阅发现的成都状态遗漏、观战抢杠页脚隐藏均已修复并回归。最后仅增加状态ARIA属性，不改浏览器测量的几何规则。
Independent review findings about Chengdu status and hidden spectator claims were fixed and regressed. The final ARIA-only improvement does not change measured geometry.

没有实测物理手机触摸、iOS Safari、浏览器地址栏动态收起或屏幕刘海设备；44px测量及指针/键盘操作不能等同这些通过。最短验收高度为320px，CSS更短时保留320px最小画布。
Physical touch, iOS Safari, dynamic browser chrome and notched devices were not tested. Hit-target measurements and pointer/keyboard checks do not establish those results. The shortest accepted height is320px; smaller viewports retain a320px minimum canvas.

云浏览器WebGL被禁用，真实桌触发原有降级到经典桌并保留选牌；不能宣称真实3D像素通过。真实组件/样式/适配器/渲染器、成都组件、server/shared规则/API、资产、依赖、锁文件和部署配置均无改动。没有真实联机动作、生产数据或发布操作。
WebGL was disabled in the cloud browser, so the original fallback to classic preserved selection; realistic3D pixels were not validated. Realistic and Chengdu components, renderers/styles/adapters, server/shared rules/APIs, assets, dependencies, lockfile and deployment configuration are unchanged. No live gameplay, production data or publication operations occurred.
