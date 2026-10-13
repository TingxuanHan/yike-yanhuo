// Platform access stays here so pages and the server contract remain portable.
module.exports = {
  openPlanning() {
    return new Promise((resolve, reject) =>
      wx.navigateTo({
        url: "/pages/planning/index",
        success: resolve,
        fail: () => reject(new Error("条件整理页面未能打开，请重新编译。")),
      }),
    );
  },
  reveal(selector) {
    wx.pageScrollTo?.({ selector, duration: 0 });
  },
  watchPrivacy(owner) {
    if (typeof wx.onNeedPrivacyAuthorization !== "function") return () => {};
    const pending = new Set();
    const listener = (resolve) => {
      pending.add(resolve);
      owner.setData({ showPrivacy: true, privacyError: "" });
    };
    owner.resolvePrivacy = (agree) => {
      pending.forEach((resolve) =>
        resolve(
          agree
            ? { event: "agree", buttonId: "privacy-agree" }
            : { event: "disagree" },
        ),
      );
      pending.clear();
      owner.setData({ showPrivacy: false });
    };
    wx.onNeedPrivacyAuthorization(listener);
    return () => {
      wx.offNeedPrivacyAuthorization?.(listener);
      owner.resolvePrivacy(false);
    };
  },
  privacyContract() {
    return new Promise((resolve, reject) => {
      if (!wx.openPrivacyContract)
        return reject(
          new Error("当前微信版本不支持查看指引，请更新微信后重试。"),
        );
      wx.openPrivacyContract({
        success: resolve,
        fail: () =>
          reject(
            new Error(
              "指引暂时无法打开，请稍后重试。仍可使用离线示例和地址草稿。",
            ),
          ),
      });
    });
  },
  get(key) {
    return wx.getStorageSync(key);
  },
  set(key, value) {
    try {
      wx.setStorageSync(key, value);
    } catch {
      throw new Error(
        "本机空间不足，内容尚未保存。请保留当前页面，移除部分入口照片后重试。",
      );
    }
  },
  remove(key) {
    wx.removeStorageSync(key);
  },
  request(options) {
    return new Promise((resolve, reject) =>
      wx.request({
        ...options,
        success: resolve,
        fail: () => reject(new Error("无法连接服务器，请检查地址和网络。")),
      }),
    );
  },
  choosePlace() {
    const privacy =
      typeof wx.requirePrivacyAuthorize === "function"
        ? new Promise((resolve, reject) =>
            wx.requirePrivacyAuthorize({
              success: resolve,
              fail: () =>
                reject(
                  new Error(
                    "尚未同意位置使用说明。可以先填写地址保存草稿，稍后再选位置。",
                  ),
                ),
            }),
          )
        : Promise.resolve();
    return privacy.then(
      () =>
        new Promise((resolve, reject) =>
          wx.chooseLocation({
            success: (p) =>
              resolve({
                name: p.name,
                address: p.address,
                position: {
                  system: "gcj02",
                  lng: p.longitude,
                  lat: p.latitude,
                },
              }),
            fail: () =>
              reject(
                new Error(
                  "位置未选定。可以先填写名称和地址保存草稿，稍后再补位置。",
                ),
              ),
          }),
        ),
    );
  },
  confirm(content) {
    return new Promise((resolve) =>
      wx.showModal({
        title: "请确认",
        content,
        confirmText: "继续",
        success: (r) => resolve(r.confirm),
        fail: () => resolve(false),
      }),
    );
  },
  async choosePhoto() {
    const selected = await new Promise((resolve, reject) =>
      wx.chooseMedia({
        count: 1,
        mediaType: ["image"],
        sourceType: ["album", "camera"],
        success: resolve,
        fail: () => reject(new Error("未选择照片，地点文字仍可保存。")),
      }),
    );
    const path = selected.tempFiles[0].tempFilePath;
    const info = await new Promise((resolve, reject) =>
      wx.getImageInfo({ src: path, success: resolve, fail: reject }),
    );
    const ratio = Math.min(1, 480 / Math.max(info.width, info.height));
    for (const quality of [65, 40, 20]) {
      const compressed = await new Promise((resolve, reject) =>
        wx.compressImage({
          src: path,
          quality,
          compressedWidth: Math.max(1, Math.round(info.width * ratio)),
          compressedHeight: Math.max(1, Math.round(info.height * ratio)),
          success: resolve,
          fail: reject,
        }),
      );
      const file = await new Promise((resolve, reject) =>
        wx.getFileSystemManager().readFile({
          filePath: compressed.tempFilePath,
          encoding: "base64",
          success: resolve,
          fail: reject,
        }),
      );
      const mime = file.data.startsWith("/9j/")
        ? "jpeg"
        : file.data.startsWith("iVBOR")
          ? "png"
          : null;
      const data = `data:image/${mime};base64,${file.data}`;
      if (mime && data.length <= 64000) return data;
    }
    throw new Error(
      "这张照片仍然过大，请裁剪入口部分后再选择。文字记录可以先保存。",
    );
  },
  openLocation(p) {
    return new Promise((resolve, reject) =>
      wx.openLocation({
        latitude: p.lat,
        longitude: p.lng,
        name: p.name,
        address: p.address,
        scale: 17,
        success: resolve,
        fail: () =>
          reject(new Error("地图未能打开，请使用地点卡中的地址和入口照片。")),
      }),
    );
  },
  openCard(token, server) {
    return new Promise((resolve, reject) =>
      wx.navigateTo({
        url: `/pages/card/index?share=${encodeURIComponent(token)}&server=${encodeURIComponent(server)}`,
        success: resolve,
        fail: () =>
          reject(new Error("卡片已生成，页面未能打开，请在分享管理中重试。")),
      }),
    );
  },
  openOutings() {
    return new Promise((resolve, reject) =>
      wx.navigateTo({
        url: "/pages/outings/index",
        success: resolve,
        fail: () =>
          reject(new Error("出门办事页面未能打开，请重新编译后重试。")),
      }),
    );
  },
  openShopping() {
    return new Promise((resolve, reject) =>
      wx.navigateTo({
        url: "/pages/shopping/index",
        success: resolve,
        fail: () => reject(new Error("购物页面未能打开，请重新编译后重试。")),
      }),
    );
  },
  openMovement() {
    return new Promise((resolve, reject) =>
      wx.navigateTo({
        url: "/pages/movement/index",
        success: resolve,
        fail: () =>
          reject(new Error("步行节奏页面未能打开，请重新编译后重试。")),
      }),
    );
  },
  revealSelected() {
    wx.pageScrollTo?.({ selector: ".selected-place", duration: 200 });
  },
  drawSketch(sketch, owner) {
    if (typeof wx.createCanvasContext !== "function") return;
    const render = (width = 320) => {
      const ctx = wx.createCanvasContext("neighborhood-sketch", owner);
      ctx.scale(width / 320, width / 320);
      ctx.setFillStyle("#edf3e9");
      ctx.fillRect(0, 0, 320, 240);
      ctx.setStrokeStyle("#ffffff");
      ctx.setLineWidth(7);
      for (let x = 30; x < 320; x += 52) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, 240);
        ctx.stroke();
      }
      for (let y = 22; y < 240; y += 48) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(320, y);
        ctx.stroke();
      }
      ctx.setStrokeStyle("#146c5d");
      ctx.setLineWidth(2.5);
      sketch.rings.forEach((ring) => {
        ctx.beginPath();
        ring.forEach((p, i) =>
          i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y),
        );
        ctx.closePath();
        ctx.stroke();
      });
      sketch.places.forEach((p, i) => {
        ctx.setFillStyle("#146c5d");
        ctx.beginPath();
        ctx.arc(p.x, p.y, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.setFillStyle("#ffffff");
        ctx.setFontSize(9);
        ctx.fillText(String(i + 1), p.x - 3, p.y + 3);
      });
      ctx.setFillStyle("#d57243");
      ctx.beginPath();
      ctx.arc(160, 120, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.setFillStyle("#243f48");
      ctx.setFontSize(11);
      ctx.fillText("出发点", 170, 123);
      ctx.draw();
    };
    if (typeof wx.createSelectorQuery === "function")
      wx.createSelectorQuery()
        .in(owner)
        .select("#neighborhood-sketch")
        .boundingClientRect((r) => render(r?.width || 320))
        .exec();
    else render();
  },
  clipboard(value) {
    return new Promise((resolve, reject) =>
      wx.setClipboardData({
        data: value,
        success: resolve,
        fail: () => reject(new Error("复制未完成，请重试。")),
      }),
    );
  },
  openTrip() {
    return new Promise((resolve, reject) =>
      wx.navigateTo({
        url: "/pages/trip/index",
        success: resolve,
        fail: () => reject(new Error("整趟行程页面未能打开，请重新编译。")),
      }),
    );
  },
};
