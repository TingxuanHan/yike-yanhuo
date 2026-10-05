// Platform access stays here so pages and the server contract remain portable.
module.exports = {
  get(key) {
    return wx.getStorageSync(key);
  },
  set(key, value) {
    wx.setStorageSync(key, value);
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
    return new Promise((resolve, reject) =>
      wx.chooseLocation({
        success: (p) =>
          resolve({
            name: p.name,
            address: p.address,
            position: { system: "gcj02", lng: p.longitude, lat: p.latitude },
          }),
        fail: () =>
          reject(new Error("未选择位置。可重试，或在Web中记录后同步。")),
      }),
    );
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
};
