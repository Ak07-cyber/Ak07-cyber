const fs = require("fs");
const https = require("https");
const path = require("path");

const owner = process.env.PROFILE_USERNAME || process.env.GITHUB_REPOSITORY_OWNER || "Ak07-cyber";
const token = process.env.GITHUB_TOKEN;
const readmePath = path.resolve(process.env.README_PATH || "README.MD");
const cacheKey = new Date().toISOString().slice(0, 10).replace(/-/g, "");

if (!token) {
  throw new Error("GITHUB_TOKEN is required to update GitHub dashboard badges.");
}

function requestJson(options, body) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = "";

      res.on("data", (chunk) => {
        data += chunk;
      });

      res.on("end", () => {
        let parsed;

        try {
          parsed = JSON.parse(data);
        } catch (error) {
          reject(new Error(`Invalid JSON response from ${options.hostname}: ${data}`));
          return;
        }

        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`GitHub API returned ${res.statusCode}: ${JSON.stringify(parsed)}`));
          return;
        }

        resolve(parsed);
      });
    });

    req.on("error", reject);

    if (body) {
      req.write(JSON.stringify(body));
    }

    req.end();
  });
}

async function getRepoCount() {
  const user = await requestJson({
    hostname: "api.github.com",
    path: `/users/${encodeURIComponent(owner)}`,
    method: "GET",
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": `${owner}-profile-readme-updater`,
      "Accept": "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
  });

  if (typeof user.public_repos !== "number") {
    throw new Error("GitHub REST response did not include public_repos.");
  }

  return user.public_repos;
}

async function getContributionCount() {
  const response = await requestJson({
    hostname: "api.github.com",
    path: "/graphql",
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "User-Agent": `${owner}-profile-readme-updater`,
      "Content-Type": "application/json",
    },
  }, {
    query: `
      query($login: String!) {
        user(login: $login) {
          contributionsCollection {
            contributionCalendar {
              totalContributions
            }
          }
        }
      }
    `,
    variables: {
      login: owner,
    },
  });

  const total = response.data?.user?.contributionsCollection?.contributionCalendar?.totalContributions;

  if (typeof total !== "number") {
    throw new Error(`GitHub GraphQL response did not include totalContributions: ${JSON.stringify(response)}`);
  }

  return total;
}

function replaceBadgeValue(markdown, label, value) {
  const badgePattern = new RegExp(`(badge/${label}-)\\d+(-[^"\\s]+)`, "g");

  if (!badgePattern.test(markdown)) {
    throw new Error(`Could not find ${label} badge in ${readmePath}.`);
  }

  return markdown.replace(badgePattern, `$1${value}$2`);
}

function refreshImageCache(markdown, imageHost) {
  const imagePattern = new RegExp(`(src="https://${imageHost.replaceAll(".", "\\.")}/[^"]*?)(?:[?&]cache_bust=\\d+)?(")`, "g");

  if (!imagePattern.test(markdown)) {
    throw new Error(`Could not find image URL for ${imageHost} in ${readmePath}.`);
  }

  return markdown.replace(imagePattern, (match, url, quote) => {
    const separator = url.includes("?") ? "&" : "?";
    return `${url}${separator}cache_bust=${cacheKey}${quote}`;
  });
}

async function main() {
  const [repositories, contributions] = await Promise.all([
    getRepoCount(),
    getContributionCount(),
  ]);

  const readme = fs.readFileSync(readmePath, "utf8");
  let updated = replaceBadgeValue(readme, "Contributions", contributions);
  updated = replaceBadgeValue(updated, "Repositories", repositories);
  updated = refreshImageCache(updated, "github-readme-stats.shion.dev");
  updated = refreshImageCache(updated, "leetcard.jacoblin.cool");

  fs.writeFileSync(readmePath, updated);

  console.log(`Updated GitHub dashboard: Contributions=${contributions}, Repositories=${repositories}, Cache=${cacheKey}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
