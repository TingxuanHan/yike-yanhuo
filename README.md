# 一刻烟火

**15分钟生活圈智能体检与规划助手**

从一个社区出发，计算步行能抵达的生活范围，查看买菜、就医、上学与休闲设施，并为待核实的服务缺口留下证据。

参赛方向：2026 上海开源软件应用创新大赛，百度地图“15 分钟生活圈”企业赛题。

## 开发状态

首版已具备可运行的模拟体检、地图工作台、百度服务适配层和报告导出。实测地区选定上海市杨浦区四平路街道，以抚顺路社区睦邻中心附近作为候选分析中心，准确坐标与出入口需独立核验。

离线样例使用人工构造的道路图和设施，用于复现算法与界面操作，不代表上海真实道路或设施分布。真实接口结果、现场对照与性能报告的状态见验证记录；不将模拟结果作为真实社区结论。

## 快速运行

需要 Node.js 22.12+，推荐24。

```sh
npm ci
npm run dev
```

访问 `http://127.0.0.1:5173`，选择模拟街区并开始体检，无需 AK。

生产预览：`npm run build` 后运行 `npm start`，访问 `http://127.0.0.1:8787`。真实地图需将 `.env.example` 复制为 `.env` 并填入独立的浏览器端、服务端 AK。两种密钥均由服务端保管，网页地图经受限代理加载。

验证：`npm test` 执行核心与接口测试；构建后 `npm run test:ui` 执行桌面、手机、报告与错误恢复检查。普通测试不调用真实地图服务。

![模拟街区工作台](docs/images/workbench-desktop.png)

## 当前功能

- 模拟起点和真实地址选点，5/10/15分钟步行范围。
- 六类设施清单、地图联动、步行时间和1公里覆盖核查点。
- 路网采样与边界加密，多片区轮廓、未知点及采样截断提示。
- 可打印体检报告与JSON导出，桌面和手机布局。
- 路线条数限流、预算持久化、短时缓存、有限重试和取消操作。

## 材料导航

- [作品介绍 PDF](materials/yike-yanhuo-introduction.pdf)
- [技术与验证报告 PDF](materials/yike-yanhuo-technical-report.pdf)
- [模拟流程演示视频](materials/yike-yanhuo-demo.webm)（无配音，非上海实测）

- [验收要求与交付清单](docs/requirements.md)
- [实现计划](docs/roadmap.md)
- [技术设计](docs/architecture.md)
- [百度地图开通与费用说明](docs/baidu-setup.md)
- [安装、验证和部署](docs/deployment.md)
- [本地接口说明](docs/api.md)
- [技术报告](docs/technical-report.md)
- [验证记录](docs/validation.md)
- [报名信息草稿](docs/submission-form.md)
- [演示脚本](docs/demo-script.md)
- [上海案例与验证计划](docs/shanghai-case.md)
- [界面设计约定](docs/frontend/DESIGN.md)
- [开发记录](CHANGELOG.md)

开发仓库暂为私有；提交参赛材料前需落实评审可访问方式和开源发布。

## 许可证

项目自有代码采用 MIT 许可证。百度地图服务、地图数据和依赖库遵循各自的授权条款；项目许可证不授予地图数据再分发权。
