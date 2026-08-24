#!/usr/bin/env bash
# Pushes every filled GEMINI_API_KEY slot in .env.local up to Vercel, replacing
# whatever is there. Run after editing .env.local:  npm run keys
set -u
cd "$(dirname "$0")/.."

found=0
for slot in GEMINI_API_KEY GEMINI_API_KEY_2 GEMINI_API_KEY_3; do
  value=$(grep "^${slot}=" .env.local 2>/dev/null | cut -d= -f2- | tr -d '"' | tr -d "'")
  if [ -z "${value}" ]; then
    echo "  ${slot}: empty, skipped"
    continue
  fi
  found=$((found + 1))
  for env in production preview development; do
    npx vercel env rm "${slot}" "${env}" --yes >/dev/null 2>&1
    printf '%s' "${value}" | npx vercel env add "${slot}" "${env}" >/dev/null 2>&1
  done
  echo "  ${slot}: pushed (…${value: -4})"
done

if [ "${found}" -eq 0 ]; then
  echo "No keys found in .env.local — nothing to push."
  exit 1
fi

echo ""
echo "${found} key(s) pushed. Deploying so they take effect…"
npx vercel --prod --yes 2>&1 | grep -oE 'https://exp[a-z0-9.-]*\.vercel\.app' | tail -1
