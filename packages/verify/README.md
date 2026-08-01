# @figloom/verify

Visual verification engine used by Figloom CLI.

```ts
import { verify, writeVerificationArtifact } from "@figloom/verify";
```

Engine owns baseline acquisition, Playwright capture, image comparison, stability checks, evidence writing, and done gates. It depends on `@figloom/contracts` and has no dependency on CLI, HTTP server, or dashboard code.
