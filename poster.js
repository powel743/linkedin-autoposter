'use strict';

/**
 * LinkedIn Auto-Poster
 *
 * Reads posts.json, posts the entry at `last_posted_index` to LinkedIn via the
 * UGC Posts API, then increments the index and commits posts.json back to the
 * repo using the GitHub Contents API. Loops back to 0 after day 30.
 *
 * Uses only Node.js built-ins (https, fs) — no external dependencies.
 *
 * Required env vars:
 *   LINKEDIN_ACCESS_TOKEN  - OAuth access token with w_member_social scope
 *   LINKEDIN_PERSON_URN    - e.g. "urn:li:person:xxxxxxxx" (or just the id)
 *   GITHUB_TOKEN           - token to commit the updated posts.json
 *   GITHUB_REPO            - "owner/repo", e.g. "powel743/linkedin-autoposter"
 *   GITHUB_BRANCH          - defaults to "main"
 */

const https = require('https');
const fs = require('fs');
const path = require('path');

const POSTS_FILE = path.join(__dirname, 'posts.json');
const PLACEHOLDER = 'PLACEHOLDER - will be replaced';
const TOTAL_DAYS = 30;

const {
  LINKEDIN_ACCESS_TOKEN,
  LINKEDIN_PERSON_URN,
  GITHUB_TOKEN,
  GITHUB_REPO,
  GITHUB_BRANCH = 'main',
} = process.env;

/** Minimal promise wrapper around https.request that returns { status, body }. */
function httpRequest(options, payload) {
  return new Promise((resolve, reject) => {
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode, body: data }));
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

/** Normalize a Person URN: accept a bare id or a full urn:li:person:... value. */
function normalizeUrn(urn) {
  if (!urn) return urn;
  return urn.startsWith('urn:li:person:') ? urn : `urn:li:person:${urn}`;
}

/** Post text content to LinkedIn via the UGC Posts API. */
async function postToLinkedIn(content) {
  const personUrn = normalizeUrn(LINKEDIN_PERSON_URN);
  const payload = JSON.stringify({
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  });

  const { status, body } = await httpRequest(
    {
      hostname: 'api.linkedin.com',
      path: '/v2/ugcPosts',
      method: 'POST',
      headers: {
        Authorization: `Bearer ${LINKEDIN_ACCESS_TOKEN}`,
        'Content-Type': 'application/json',
        'X-Restli-Protocol-Version': '2.0.0',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    payload
  );

  if (status < 200 || status >= 300) {
    throw new Error(`LinkedIn API returned ${status}: ${body}`);
  }
  return body;
}

/** Commit the updated posts.json back to the repo via the GitHub Contents API. */
async function commitPostsFile(fileContents, message) {
  if (!GITHUB_TOKEN || !GITHUB_REPO) {
    console.warn(
      '⚠️  GITHUB_TOKEN or GITHUB_REPO missing — skipping commit of posts.json.'
    );
    return;
  }

  const apiPath = `/repos/${GITHUB_REPO}/contents/posts.json`;
  const baseHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    'User-Agent': 'linkedin-autoposter',
    Accept: 'application/vnd.github+json',
  };

  // 1. Get the current file SHA (required to update an existing file).
  const getRes = await httpRequest({
    hostname: 'api.github.com',
    path: `${apiPath}?ref=${encodeURIComponent(GITHUB_BRANCH)}`,
    method: 'GET',
    headers: baseHeaders,
  });

  if (getRes.status < 200 || getRes.status >= 300) {
    throw new Error(
      `GitHub get-file returned ${getRes.status}: ${getRes.body}`
    );
  }
  const sha = JSON.parse(getRes.body).sha;

  // 2. Commit the new contents.
  const payload = JSON.stringify({
    message,
    content: Buffer.from(fileContents).toString('base64'),
    sha,
    branch: GITHUB_BRANCH,
  });

  const putRes = await httpRequest(
    {
      hostname: 'api.github.com',
      path: apiPath,
      method: 'PUT',
      headers: {
        ...baseHeaders,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    },
    payload
  );

  if (putRes.status < 200 || putRes.status >= 300) {
    throw new Error(`GitHub commit returned ${putRes.status}: ${putRes.body}`);
  }
}

async function main() {
  // Validate required LinkedIn env vars up front.
  const missing = ['LINKEDIN_ACCESS_TOKEN', 'LINKEDIN_PERSON_URN'].filter(
    (k) => !process.env[k]
  );
  if (missing.length) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`);
  }

  const data = JSON.parse(fs.readFileSync(POSTS_FILE, 'utf8'));
  let index = data.last_posted_index || 0;

  // Loop back to the start after the last day.
  if (index >= TOTAL_DAYS) index = 0;

  const post = data.posts[index];
  if (!post) {
    throw new Error(`No post found at index ${index}.`);
  }

  console.log('──────────────────────────────────────────────');
  console.log(`📅 Day ${post.day} (index ${index})`);
  console.log(`📝 Content:\n${post.content}`);
  console.log('──────────────────────────────────────────────');

  // Skip if content is still the placeholder.
  if (post.content.trim() === PLACEHOLDER) {
    console.log(
      `⏭️  Skipping: day ${post.day} still has placeholder content. ` +
        'Fill in posts.json and re-run.'
    );
    return;
  }

  // Post to LinkedIn.
  console.log('🚀 Posting to LinkedIn...');
  await postToLinkedIn(post.content);
  console.log(`✅ Successfully posted day ${post.day} to LinkedIn.`);

  // Advance the index, looping at TOTAL_DAYS.
  let nextIndex = index + 1;
  if (nextIndex >= TOTAL_DAYS) {
    nextIndex = 0;
    console.log('🔁 Reached day 30 — resetting index to 0 (loop).');
  }
  data.last_posted_index = nextIndex;

  const updated = JSON.stringify(data, null, 2) + '\n';
  fs.writeFileSync(POSTS_FILE, updated);

  // Commit the updated posts.json back to the repo.
  console.log(`💾 Committing posts.json (last_posted_index → ${nextIndex})...`);
  await commitPostsFile(
    updated,
    `chore: posted day ${post.day}, advance index to ${nextIndex}`
  );
  console.log('✅ posts.json committed.');
}

main().catch((err) => {
  console.error('❌ Error:', err.message);
  process.exit(1);
});
