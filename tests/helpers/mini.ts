import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { resolve, dirname, sep } from "node:path";

export function miniRuntime(
  storage = new Map<string, any>(),
  overrides: Record<string, any> = {},
) {
  let page: any;
  const root = resolve("miniprogram"),
    modules = new Map<string, any>();
  const wx = {
    getStorageSync: (k: string) => storage.get(k),
    setStorageSync: (k: string, v: any) => storage.set(k, structuredClone(v)),
    removeStorageSync: (k: string) => storage.delete(k),
    showModal: (o: any) => o.success({ confirm: true }),
    chooseLocation: (o: any) => o.fail({}),
    request: () => {
      throw new Error("Unexpected network access");
    },
    ...overrides,
  };
  function load(path: string): any {
    path = resolve(path);
    assert.ok(path.startsWith(root + sep));
    if (modules.has(path)) return modules.get(path);
    const module = { exports: {} };
    const wrapper = vm.runInNewContext(
      `(function(require,module,exports){${readFileSync(path, "utf8")}\n})`,
      {
        wx,
        Page: (p: any) => {
          page = p;
        },
        Component: (p: any) => {
          page = p;
        },
        setTimeout,
        clearTimeout,
        setInterval,
        clearInterval,
      },
    );
    wrapper(
      (name: string) => load(resolve(dirname(path), name)),
      module,
      module.exports,
    );
    modules.set(path, module.exports);
    return module.exports;
  }
  return {
    storage,
    load: (name: string) => load(resolve(root, name)),
    component(name: string, properties: Record<string, unknown>) {
      load(resolve(root, `components/${name}/index.js`));
      const component = {
        ...page,
        ...page.methods,
        data: structuredClone(page.data),
        properties,
        setData(patch: Record<string, unknown>) {
          Object.assign(this.data, patch);
        },
      };
      component.lifetimes.attached.call(component);
      return component;
    },
    page(name = "home") {
      load(resolve(root, `pages/${name}/index.js`));
      page.setData = function (
        patch: Record<string, any>,
        callback?: () => void,
      ) {
        assert.ok(
          Buffer.byteLength(JSON.stringify(patch), "utf8") <= 1_000_000,
          "mini setData payload exceeds transport budget",
        );
        for (const [key, value] of Object.entries(patch)) {
          const parts = key.split(".");
          let obj = this.data;
          for (const part of parts.slice(0, -1)) obj = obj[part];
          obj[parts.at(-1)!] = value;
        }
        callback?.();
      };
      return page;
    },
  };
}
