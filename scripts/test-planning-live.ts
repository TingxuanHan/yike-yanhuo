import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { randomUUID } from "node:crypto";
import { AiService } from "../src/server/ai-service.js";

if (!process.argv.includes("--confirm-one-call")) {
  console.log(
    "未调用模型。填写项目.env后，追加--confirm-one-call可发送一条固定示例；会占用平台保护额度和服务商额度。",
  );
} else {
  if (existsSync(".env")) loadEnvFile(".env");
  if (!process.env.AI_FREE_KEY) {
    console.log(
      "未调用模型：请在本机.env填写AI_FREE_KEY、AI_FREE_BASE_URL和AI_FREE_MODEL，不要把密钥发到聊天或提交仓库。",
    );
    process.exitCode = 1;
  } else {
    const service = new AiService({
      ...process.env,
      PERSONAL_DATA_PATH: process.env.PERSONAL_DATA_PATH || ".data/life.sqlite",
    });
    try {
      const result = await service.run(
        "operator-fixed-test",
        "operator-fixed-test",
        {
          text: "带50元买菜，45分钟内回来，想顺便走20分钟，返程轻松走。",
          mode: "free",
          requestId: randomUUID(),
        },
      );
      const ok =
        result.draft.tripMinutes === 45 &&
        result.draft.shoppingBudget === 50 &&
        result.draft.walkingMinutes === 20 &&
        result.draft.returnEasy === true;
      console.log(
        ok
          ? "固定示例通过：时间、预算、步行目标与返程偏好均提取正确；真实请求1次，地图请求0次。"
          : "接口已响应，但固定示例的条件提取未全部匹配。请在确认页核对；未自动重试。真实请求1次，地图请求0次。",
      );
      if (!ok) process.exitCode = 1;
    } catch {
      console.log(
        "模型测试未通过，未自动重试。请检查服务商状态、所选模型和项目保护额度；原始响应与密钥不输出。",
      );
      process.exitCode = 1;
    } finally {
      service.close();
    }
  }
}
