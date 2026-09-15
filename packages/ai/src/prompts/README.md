# Prompts

Every prompt Goodies Beacon sends lives here, one file per role and version.

## They are TypeScript, not Markdown

A prompt is data, and the obvious thing is a `.md` file read at runtime. This directory holds
`.ts` files instead, and sits under `src/` rather than at the package root, for the same reason:
a file read at runtime has to *be* there at runtime. `tsc` emits only what is under `src`, so a
Markdown prompt — or a `.ts` one outside `src` — needs its own line in the Dockerfile's
hand-maintained copy list, and forgetting a line in that list has already broken the image twice
(P1-04, P1-08). A prompt that is a module under `src` is built and copied by the same mechanism as
the code that uses it, cannot drift from it, and is type-checked besides.

The cost is that a prompt is a template literal rather than prose in a file. It is a small cost:
the text is still the whole file, and `packages/ai/src/prompts/**` is the path P1-17's eval
workflow filters on.

## Versioning

One file per version, named `<role>.v<n>.ts`, each exporting its version string. **Edit in place
while a version is unreleased; add a new file once one has judged real listings**, because a
verdict records which prompt produced it and rewriting history under it makes an old verdict
unexplainable — the same reason spec versions are immutable (ARCHITECTURE.md §4).

Every file starts with a changelog header: what changed, when, and why. P1-17's eval suite is what
says whether a change was an improvement; the header says what was tried.
