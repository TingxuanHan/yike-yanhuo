// Reserved adapter; an Alipay app manifest, permission review and device QA are still required.
module.exports = {
  openOutings() {
    return new Promise((resolve, reject) =>
      my.navigateTo({
        url: "/pages/outings/index",
        success: resolve,
        fail: () => reject(new Error("出门办事页面尚未适配当前平台。")),
      }),
    );
  },
  get(key) {
    return my.getStorageSync({ key }).data;
  },
  set(key, data) {
    my.setStorageSync({ key, data });
  },
  remove(key) {
    my.removeStorageSync({ key });
  },
  request(options) {
    return new Promise((resolve, reject) =>
      my.request({
        url: options.url,
        method: options.method,
        data: options.data,
        headers: options.header,
        success: (r) => resolve({ statusCode: r.status, data: r.data }),
        fail: () => reject(new Error("无法连接服务器，请检查地址和网络。")),
      }),
    );
  },
  choosePlace() {
    return new Promise((resolve, reject) =>
      my.chooseLocation({
        success: (p) =>
          resolve({
            name: p.name,
            address: p.address,
            position: {
              system: "gcj02",
              lng: Number(p.longitude),
              lat: Number(p.latitude),
            },
          }),
        fail: () =>
          reject(new Error("未选择位置。可重试，或在Web中记录后同步。")),
      }),
    );
  },
  clipboard(value) {
    return new Promise((resolve, reject) =>
      my.setClipboard({
        text: value,
        success: resolve,
        fail: () => reject(new Error("复制未完成，请重试。")),
      }),
    );
  },
};
