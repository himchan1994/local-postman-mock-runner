const express = require("express");
const fs = require("fs");
const path = require("path");
const cors = require("cors");

const app = express();
const PORT = 3001;
const COLLECTION_PATH = path.join(__dirname, "postman.json");

app.use(
  cors({
    origin: "http://localhost:3000", // 필요 시 '*'로 변경 가능
  })
);

app.use(express.json());

/**
 * \b 제거 및 경로 조합
 */
function normalizePath(pathParts) {
  return "/" + pathParts.map((p) => p.replace(/\u0008/g, "").trim()).join("/");
}

/**
 * 주석 제거 후 JSON 파싱
 */
function safeParseJson(jsonStr, path, method) {
  try {
    const noComments = jsonStr.replace(/\/\/.*$/gm, "");
    return JSON.parse(noComments);
  } catch (e) {
    console.error(
      `❌ Failed to parse JSON for ${method.toUpperCase()} ${path}`
    );
    return null;
  }
}

/**
 * Postman collection에서 라우트 등록
 */
function registerRoutesFromPostman(collection) {
  const endpoints = new Map();

  function extractItems(items) {
    for (const item of items) {
      if (item.item) {
        extractItems(item.item); // folder
      } else {
        const request = item.request || {};
        const method = (request.method || "GET").toLowerCase();
        const pathParts = request.url?.path || [];
        const rawPath = normalizePath(pathParts);
        const responseBody = item.response?.[0]?.body;

        if (responseBody) {
          const key = `${method}:${rawPath}`;
          if (!endpoints.has(key)) {
            endpoints.set(key, {
              method,
              path: rawPath,
              response: responseBody,
            });
          }
        }
      }
    }
  }

  extractItems(collection.item);

  // 실제 라우터 등록
  for (const { method, path, response } of endpoints.values()) {
    const json = safeParseJson(response, path, method);
    if (json) {
      app[method](path, (req, res) => {
        res.json(json);
      });
      console.log(`✅ Registered: [${method.toUpperCase()}] ${path}`);
    }
  }
}

// 서버 실행
try {
  const raw = fs.readFileSync(COLLECTION_PATH, "utf-8");
  const postmanCollection = JSON.parse(raw);
  registerRoutesFromPostman(postmanCollection);
} catch (error) {
  console.error("❌ Failed to load Postman collection:", error.message);
}

app.listen(PORT, () => {
  console.log(`🚀 Mock server is running at http://localhost:${PORT}`);
});
