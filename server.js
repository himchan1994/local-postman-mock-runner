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
 * 주석 제거 및 잘못된 JSON 자동 수정 후 파싱
 */
function safeParseJson(jsonStr, path, method) {
  let cleanJson = jsonStr;

  try {
    // 1. 더 정교한 주석 제거 (URL의 :// 부분을 보호)
    cleanJson = cleanJson.replace(/\/\*[\s\S]*?\*\//g, ""); // 블록 주석 제거

    // // 주석 제거 시 URL의 :// 부분을 보호
    // 먼저 URL 패턴을 임시로 교체 (httpe 같은 잘못된 형태도 포함)
    const urlPlaceholders = [];
    cleanJson = cleanJson.replace(/"https?[^"]*:\/\/[^"]*"/g, (match) => {
      const placeholder = `__URL_PLACEHOLDER_${urlPlaceholders.length}__`;
      urlPlaceholders.push(match);
      return placeholder;
    });

    // 이제 안전하게 // 주석 제거
    cleanJson = cleanJson.replace(/\/\/.*$/gm, "");

    // URL 복원
    urlPlaceholders.forEach((url, index) => {
      const placeholder = `__URL_PLACEHOLDER_${index}__`;
      cleanJson = cleanJson.replace(placeholder, url);
    });

    // 2. 제어 문자 제거 (줄바꿈과 공백은 유지하면서 잘못된 제어 문자만 제거)
    cleanJson = cleanJson.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");

    // 3. 빈 줄 제거
    cleanJson = cleanJson.replace(/^\s*[\r\n]/gm, "");

    // 4. 주석 제거 후 남은 쉼표 정리
    cleanJson = cleanJson.replace(/\n\s*,/g, ",");

    // 5. 쉼표 누락 문제 해결 (더 정교하게)
    // 문자열, 숫자, 불린, null 값 다음에 바로 새로운 속성이 오는 경우
    cleanJson = cleanJson.replace(
      /(".*"|\d+(?:\.\d+)?|true|false|null)\s*\n\s*("[^"]*":)/g,
      "$1,\n            $2"
    );

    // 6. 객체나 배열 종료 다음에 새로운 속성이 오는 경우
    cleanJson = cleanJson.replace(
      /([}\]])\s*\n\s*("[^"]*":)/g,
      "$1,\n            $2"
    );

    // 7. 빈 키 처리 (완전히 빈 키만 처리)
    cleanJson = cleanJson.replace(/^\s*""\s*:\s*""/gm, '"unknown": ""');

    // 8. 객체/배열 시작 직후 쉼표 제거
    cleanJson = cleanJson.replace(/([{\[])\s*,/g, "$1");

    // 9. 객체/배열 끝 직전 쉼표 제거
    cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1");

    // 10. 연속된 쉼표 제거
    cleanJson = cleanJson.replace(/,\s*,/g, ",");

    // 11. 첫 번째 파싱 시도
    return JSON.parse(cleanJson);
  } catch (e) {
    try {
      // 12. 더 강력한 수정 시도 - 각 줄을 개별적으로 처리
      const lines = cleanJson.split("\n");
      const fixedLines = [];

      for (let i = 0; i < lines.length; i++) {
        let line = lines[i].trim();

        // 빈 줄이나 주석만 있는 줄 건너뛰기
        if (!line || line.startsWith("//") || line.startsWith("/*")) {
          continue;
        }

        // 특별한 케이스: 빈 문자열 값 처리 (더 정확한 매칭)
        if (line.match(/^\s*"[^"]*":\s*""$/)) {
          // 다음 줄이 새로운 속성인지 확인
          let nextLineIndex = i + 1;
          while (nextLineIndex < lines.length) {
            const nextLine = lines[nextLineIndex].trim();
            if (
              nextLine &&
              !nextLine.startsWith("//") &&
              !nextLine.startsWith("/*")
            ) {
              if (nextLine.startsWith('"') && nextLine.includes(":")) {
                line += ",";
              }
              break;
            }
            nextLineIndex++;
          }
        }

        // 마지막 줄이 아니고, 다음 줄이 새로운 속성인 경우 쉼표 추가
        if (i < lines.length - 1) {
          let nextLineIndex = i + 1;
          let nextLine = "";

          // 다음 빈 줄이 아닌 줄을 찾기
          while (nextLineIndex < lines.length) {
            const temp = lines[nextLineIndex].trim();
            if (temp && !temp.startsWith("//") && !temp.startsWith("/*")) {
              nextLine = temp;
              break;
            }
            nextLineIndex++;
          }

          if (nextLine && nextLine.startsWith('"') && nextLine.includes(":")) {
            // 현재 줄이 속성 값으로 끝나고 쉼표가 없는 경우
            if (
              (line.endsWith('"') ||
                line.endsWith("}") ||
                line.endsWith("]") ||
                /\d$/.test(line) ||
                line.endsWith("true") ||
                line.endsWith("false") ||
                line.endsWith("null")) &&
              !line.endsWith(",")
            ) {
              line += ",";
            }
          }
        }

        fixedLines.push(line);
      }

      cleanJson = fixedLines.join("\n");

      // 13. 다시 정리
      cleanJson = cleanJson.replace(/,\s*([}\]])/g, "$1"); // 마지막 쉼표 제거
      cleanJson = cleanJson.replace(/([{\[])\s*,/g, "$1"); // 첫 번째 쉼표 제거

      return JSON.parse(cleanJson);
    } catch (e2) {
      console.log("Original JSON string:", jsonStr);
      console.log("Final cleaned JSON string:", cleanJson);
      console.log("Parse error:", e2.message);
      console.error(
        `❌ Failed to parse JSON for ${method.toUpperCase()} ${path}`
      );
      return null;
    }
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
