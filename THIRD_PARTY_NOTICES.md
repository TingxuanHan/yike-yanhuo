# 第三方依赖与材料说明

依据当前package-lock.json，包含平台可选包；清单是许可证声明盘点，不等同于完整法律审计。项目自有代码采用MIT，上游软件各自保留原许可。生成命令：`node scripts/dependency-inventory.mjs`。

- 分发依赖时保留其版权、LICENSE和NOTICE；本仓库不打包node_modules。准确源码位置见各包发布页及其Repository链接。
- MPL-2.0项属于构建工具链（如lightningcss及平台包），不因项目采用MIT而改为MIT；如分发其二进制或修改源码，需保留对应通知并提供该部分源码获取途径。[Mozilla官方说明](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)。
- 百度地图数据、底图、商标与服务不属于本项目MIT授权范围；截图与小规模API案例仅作功能和实验说明，不作为开放地图数据集。完整原始实验数据仍在本机忽略目录。
- 模型／语音服务及模型权重遵循供应商与模型自己的条款；仓库不分发模型权重或供应商密钥。
- 视频使用本机中文语音和项目画面，没有引入第三方音乐；制作工具与系统字体不随源码打包。

| 包 | 版本 | 许可证声明 | 用途 | 来源 |
| --- | --- | --- | --- | --- |
| @esbuild/aix-ppc64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/aix-ppc64/v/0.28.2) |
| @esbuild/android-arm | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/android-arm/v/0.28.2) |
| @esbuild/android-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/android-arm64/v/0.28.2) |
| @esbuild/android-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/android-x64/v/0.28.2) |
| @esbuild/darwin-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/darwin-arm64/v/0.28.2) |
| @esbuild/darwin-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/darwin-x64/v/0.28.2) |
| @esbuild/freebsd-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/freebsd-arm64/v/0.28.2) |
| @esbuild/freebsd-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/freebsd-x64/v/0.28.2) |
| @esbuild/linux-arm | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-arm/v/0.28.2) |
| @esbuild/linux-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-arm64/v/0.28.2) |
| @esbuild/linux-ia32 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-ia32/v/0.28.2) |
| @esbuild/linux-loong64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-loong64/v/0.28.2) |
| @esbuild/linux-mips64el | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-mips64el/v/0.28.2) |
| @esbuild/linux-ppc64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-ppc64/v/0.28.2) |
| @esbuild/linux-riscv64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-riscv64/v/0.28.2) |
| @esbuild/linux-s390x | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-s390x/v/0.28.2) |
| @esbuild/linux-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/linux-x64/v/0.28.2) |
| @esbuild/netbsd-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/netbsd-arm64/v/0.28.2) |
| @esbuild/netbsd-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/netbsd-x64/v/0.28.2) |
| @esbuild/openbsd-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/openbsd-arm64/v/0.28.2) |
| @esbuild/openbsd-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/openbsd-x64/v/0.28.2) |
| @esbuild/openharmony-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/openharmony-arm64/v/0.28.2) |
| @esbuild/sunos-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/sunos-x64/v/0.28.2) |
| @esbuild/win32-arm64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/win32-arm64/v/0.28.2) |
| @esbuild/win32-ia32 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/win32-ia32/v/0.28.2) |
| @esbuild/win32-x64 | 0.28.2 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@esbuild/win32-x64/v/0.28.2) |
| @oxc-project/types | 0.152.0 | MIT | development | [发布页](https://www.npmjs.com/package/@oxc-project/types/v/0.152.0) |
| @playwright/test | 1.63.0 | Apache-2.0 | development | [发布页](https://www.npmjs.com/package/@playwright/test/v/1.63.0) |
| @rolldown/binding-android-arm-eabi | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-android-arm-eabi/v/1.2.12) |
| @rolldown/binding-android-arm64 | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-android-arm64/v/1.2.12) |
| @rolldown/binding-darwin-arm64 | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-darwin-arm64/v/1.2.12) |
| @rolldown/binding-darwin-x64 | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-darwin-x64/v/1.2.12) |
| @rolldown/binding-freebsd-x64 | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-freebsd-x64/v/1.2.12) |
| @rolldown/binding-linux-arm-gnueabihf | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-arm-gnueabihf/v/1.2.12) |
| @rolldown/binding-linux-arm64-gnu | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-arm64-gnu/v/1.2.12) |
| @rolldown/binding-linux-arm64-musl | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-arm64-musl/v/1.2.12) |
| @rolldown/binding-linux-ppc64-gnu | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-ppc64-gnu/v/1.2.12) |
| @rolldown/binding-linux-s390x-gnu | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-s390x-gnu/v/1.2.12) |
| @rolldown/binding-linux-x64-gnu | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-x64-gnu/v/1.2.12) |
| @rolldown/binding-linux-x64-musl | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-linux-x64-musl/v/1.2.12) |
| @rolldown/binding-openharmony-arm64 | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-openharmony-arm64/v/1.2.12) |
| @rolldown/binding-win32-arm64-msvc | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-win32-arm64-msvc/v/1.2.12) |
| @rolldown/binding-win32-x64-msvc | 1.2.12 | MIT | development / optional | [发布页](https://www.npmjs.com/package/@rolldown/binding-win32-x64-msvc/v/1.2.12) |
| @rolldown/pluginutils | 1.0.1 | MIT | development | [发布页](https://www.npmjs.com/package/@rolldown/pluginutils/v/1.0.1) |
| @types/node | 26.6.4 | MIT | development | [发布页](https://www.npmjs.com/package/@types/node/v/26.6.4) |
| @types/react | 19.3.0 | MIT | development | [发布页](https://www.npmjs.com/package/@types/react/v/19.3.0) |
| @types/react-dom | 19.3.0 | MIT | development | [发布页](https://www.npmjs.com/package/@types/react-dom/v/19.3.0) |
| @typescript/typescript-aix-ppc64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-aix-ppc64/v/7.0.2) |
| @typescript/typescript-darwin-arm64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-darwin-arm64/v/7.0.2) |
| @typescript/typescript-darwin-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-darwin-x64/v/7.0.2) |
| @typescript/typescript-freebsd-arm64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-freebsd-arm64/v/7.0.2) |
| @typescript/typescript-freebsd-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-freebsd-x64/v/7.0.2) |
| @typescript/typescript-linux-arm | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-arm/v/7.0.2) |
| @typescript/typescript-linux-arm64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-arm64/v/7.0.2) |
| @typescript/typescript-linux-loong64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-loong64/v/7.0.2) |
| @typescript/typescript-linux-mips64el | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-mips64el/v/7.0.2) |
| @typescript/typescript-linux-ppc64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-ppc64/v/7.0.2) |
| @typescript/typescript-linux-riscv64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-riscv64/v/7.0.2) |
| @typescript/typescript-linux-s390x | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-s390x/v/7.0.2) |
| @typescript/typescript-linux-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-linux-x64/v/7.0.2) |
| @typescript/typescript-netbsd-arm64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-netbsd-arm64/v/7.0.2) |
| @typescript/typescript-netbsd-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-netbsd-x64/v/7.0.2) |
| @typescript/typescript-openbsd-arm64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-openbsd-arm64/v/7.0.2) |
| @typescript/typescript-openbsd-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-openbsd-x64/v/7.0.2) |
| @typescript/typescript-sunos-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-sunos-x64/v/7.0.2) |
| @typescript/typescript-win32-arm64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-win32-arm64/v/7.0.2) |
| @typescript/typescript-win32-x64 | 7.0.2 | Apache-2.0 | development / optional | [发布页](https://www.npmjs.com/package/@typescript/typescript-win32-x64/v/7.0.2) |
| @vitejs/plugin-react | 6.1.1 | MIT | development | [发布页](https://www.npmjs.com/package/@vitejs/plugin-react/v/6.1.1) |
| csstype | 3.2.3 | MIT | development | [发布页](https://www.npmjs.com/package/csstype/v/3.2.3) |
| detect-libc | 2.1.2 | Apache-2.0 | development | [发布页](https://www.npmjs.com/package/detect-libc/v/2.1.2) |
| esbuild | 0.28.2 | MIT | development | [发布页](https://www.npmjs.com/package/esbuild/v/0.28.2) |
| fdir | 6.5.0 | MIT | development | [发布页](https://www.npmjs.com/package/fdir/v/6.5.0) |
| fsevents | 2.3.3 | MIT | development / optional | [发布页](https://www.npmjs.com/package/fsevents/v/2.3.3) |
| lightningcss | 1.33.0 | MPL-2.0 | development | [发布页](https://www.npmjs.com/package/lightningcss/v/1.33.0) |
| lightningcss-android-arm64 | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-android-arm64/v/1.33.0) |
| lightningcss-darwin-arm64 | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-darwin-arm64/v/1.33.0) |
| lightningcss-darwin-x64 | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-darwin-x64/v/1.33.0) |
| lightningcss-freebsd-x64 | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-freebsd-x64/v/1.33.0) |
| lightningcss-linux-arm-gnueabihf | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-linux-arm-gnueabihf/v/1.33.0) |
| lightningcss-linux-arm64-gnu | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-linux-arm64-gnu/v/1.33.0) |
| lightningcss-linux-arm64-musl | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-linux-arm64-musl/v/1.33.0) |
| lightningcss-linux-x64-gnu | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-linux-x64-gnu/v/1.33.0) |
| lightningcss-linux-x64-musl | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-linux-x64-musl/v/1.33.0) |
| lightningcss-win32-arm64-msvc | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-win32-arm64-msvc/v/1.33.0) |
| lightningcss-win32-x64-msvc | 1.33.0 | MPL-2.0 | development / optional | [发布页](https://www.npmjs.com/package/lightningcss-win32-x64-msvc/v/1.33.0) |
| nanoid | 3.3.19 | MIT | development | [发布页](https://www.npmjs.com/package/nanoid/v/3.3.19) |
| picocolors | 1.1.1 | ISC | development | [发布页](https://www.npmjs.com/package/picocolors/v/1.1.1) |
| picomatch | 4.0.7 | MIT | development | [发布页](https://www.npmjs.com/package/picomatch/v/4.0.7) |
| playwright | 1.63.0 | Apache-2.0 | development | [发布页](https://www.npmjs.com/package/playwright/v/1.63.0) |
| playwright-core | 1.63.0 | Apache-2.0 | development | [发布页](https://www.npmjs.com/package/playwright-core/v/1.63.0) |
| polygon-clipping | 0.15.7 | MIT | runtime | [发布页](https://www.npmjs.com/package/polygon-clipping/v/0.15.7) |
| postcss | 8.5.28 | MIT | development | [发布页](https://www.npmjs.com/package/postcss/v/8.5.28) |
| prettier | 3.9.9 | MIT | development | [发布页](https://www.npmjs.com/package/prettier/v/3.9.9) |
| react | 19.3.0 | MIT | runtime | [发布页](https://www.npmjs.com/package/react/v/19.3.0) |
| react-dom | 19.3.0 | MIT | runtime | [发布页](https://www.npmjs.com/package/react-dom/v/19.3.0) |
| robust-predicates | 3.0.3 | Unlicense | runtime | [发布页](https://www.npmjs.com/package/robust-predicates/v/3.0.3) |
| rolldown | 1.2.12 | MIT | development | [发布页](https://www.npmjs.com/package/rolldown/v/1.2.12) |
| scheduler | 0.28.0 | MIT | runtime | [发布页](https://www.npmjs.com/package/scheduler/v/0.28.0) |
| source-map-js | 1.2.2 | BSD-3-Clause | development | [发布页](https://www.npmjs.com/package/source-map-js/v/1.2.2) |
| splaytree | 3.2.3 | MIT | runtime | [发布页](https://www.npmjs.com/package/splaytree/v/3.2.3) |
| tinyglobby | 0.2.17 | MIT | development | [发布页](https://www.npmjs.com/package/tinyglobby/v/0.2.17) |
| tsx | 4.23.15 | MIT | development | [发布页](https://www.npmjs.com/package/tsx/v/4.23.15) |
| typescript | 7.0.2 | Apache-2.0 | development | [发布页](https://www.npmjs.com/package/typescript/v/7.0.2) |
| undici-types | 8.9.0 | MIT | development | [发布页](https://www.npmjs.com/package/undici-types/v/8.9.0) |
| vite | 8.3.2 | MIT | development | [发布页](https://www.npmjs.com/package/vite/v/8.3.2) |
