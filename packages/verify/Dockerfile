FROM mcr.microsoft.com/playwright:v1.61.1-noble

ENV CI=true
ENV NODE_ENV=development

# Keep the font set deterministic for design-system captures, including
# emoji and the common Noto glyph ranges used by dogfood applications.
RUN apt-get update \
  && apt-get install --no-install-recommends -y \
    fontconfig \
    fonts-noto-core \
    fonts-noto-color-emoji \
  && fc-cache -f \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /workspace

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY packages/contracts/package.json ./packages/contracts/package.json
COPY packages/verify/package.json ./packages/verify/package.json
RUN corepack enable && pnpm install --frozen-lockfile --filter @figloom/verify...

COPY packages/contracts/src ./packages/contracts/src
COPY packages/verify/src ./packages/verify/src
COPY packages/verify/scripts ./packages/verify/scripts

WORKDIR /workspace/packages/verify

# Arguments are passed to the package's low-level capture command:
#   docker run --rm <image> <url> <out.png> <width>x<height> [selector]
ENTRYPOINT ["pnpm", "exec", "tsx", "scripts/capture.ts"]
