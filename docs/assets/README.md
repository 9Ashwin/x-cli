# README artwork

Both `README.md` and `README.en.md` use these assets:

| Asset | Purpose |
| --- | --- |
| `xx-hero-v2.png` | Monochrome X-inspired header with the current project name |
| `xx-workflow.png` | Bilingual four-panel reply workflow: discover, read, draft, verify |

These are promotional and explanatory illustrations, not screenshots of the
CLI or evidence of platform operations. The workflow assigns judgement and
writing to the calling agent. Execution stays within the user's authorization,
a receipt precedes sending, and uncertain delivery is inspected rather than
automatically resent.

Generated on 2026-11-03 with the built-in ImageGen tool. The supplied X loading
screen informed the visual direction; the banner is a new generated image.

## Original hero generation prompt

```text
Use case: ads-marketing.
Asset type: GitHub README hero banner for the open-source developer tool xx. Create a finished premium graphic, very wide landscape, approximately 3:1 aspect ratio (1800 x 600 if possible).
Primary request: An elegant X / Twitter-inspired identity banner. The visual reference is the X loading screen: pure black, a precise white X mark, extreme restraint and generous negative space.
Scene/backdrop: Solid true black #000000 edge to edge. Flat graphic design with very faint charcoal hairlines only.
Composition: Crisp editorial typographic layout. Left two-thirds: large lowercase bold white sans-serif product name "xx"; beneath it a smaller white sentence "X, from your terminal."; beneath that a spaced small gray monospaced line "READ  /  REPLY  /  RECORD". Right third: one large clean white X platform-style emblem, with the recognizable crossing fine double-line diagonal and solid opposing diagonal, balanced in generous black space. A barely visible charcoal rectangular terminal-frame outline behind the right-side emblem subtly connects the platform to a CLI. Keep all main elements safely inside a 7% margin. Maintain strong readability when displayed at 900 pixels wide.
Style/medium: Extremely clean flat digital brand artwork, precise typography, high contrast, understated X dark-mode aesthetic. A deliberate polished open-source software cover.
Text (verbatim, only these three text lines): "xx"; "X, from your terminal."; "READ  /  REPLY  /  RECORD".
Constraints: Only black, white and neutral gray. No gradients, no neon, no blue bird, no cyan or pink, no 3D, no glow, no photos, no mascots, no people, no additional logos, no official-affiliation language, no decorative circuit-board pattern, no extra copy, no watermark.
```

The initial artwork used the former name `xx`. The following edits align
its visible names and commands with the repository's rename to `xx`.

## Workflow generation prompt

```text
Use case: infographic-diagram.
Asset type: A finished four-panel workflow illustration for the Chinese and English GitHub READMEs of xx. Landscape 3:2 canvas, approximately 1800 x 1200. This is explanatory product artwork, not a real screenshot.
Primary request: Show a caller-controlled X reply workflow, in the same visual language as an X dark-mode brand banner: pure black background, white typography, gray hairline borders, elegant minimalism. Exactly FOUR panels in a balanced 2-by-2 grid, numbered 01 to 04 in normal reading order. Use generous spacing, substantial readable lettering, and concrete flat illustrations of post cards, reply threads, a draft editor, and a receipt. No mascot and no decorative technology imagery.
Header: a modest white X emblem at upper left beside the product name "xx", followed by the exact title "THE REPLY WORKFLOW". Under it a clear bilingual ownership statement: "Agent 判断与写作 · xx 操作与记录" and smaller "Agent decides and writes. xx executes and records."
Panel 01, top left:
Title exactly "01  发现帖子 / DISCOVER".
Illustration: a search field and three stacked stylized X post cards, tiny neutral circular avatar placeholders and gray content lines, with one card outlined in white to indicate a candidate. No fabricated readable posts, engagement numbers or usernames.
Caption exactly "时间线 · 热榜 · 关键词" with smaller English "Timeline · Trends · Search".
A crisp monospace command chip exactly "xx auto suggest".
Panel 02, top right:
Title exactly "02  读懂上下文 / READ".
Illustration: one original post card linked to two indented reply cards and a small magnifying-glass icon. It should clearly read as a conversation thread.
Caption exactly "原帖 · 评论 · 互动数据" with smaller English "Post · Replies · Engagement".
Command chip exactly "xx comment section".
Panel 03, bottom left:
Title exactly "03  拟稿与检查 / DRAFT".
Illustration: an editor card visibly labeled "AGENT", a pencil and gray text lines, with an adjacent small review/checklist card. This panel must make clear that the external agent chooses the target and writes the text; xx only checks a supplied draft.
Caption exactly "Agent 选目标、写正文" with smaller English "The agent chooses and writes".
Command chip exactly "xx comment check".
Panel 04, bottom right:
Title exactly "04  执行与核验 / VERIFY".
Illustration: a horizontal sequence of THREE clear line icons connected by short arrows: a durable receipt document FIRST, a paper-plane send icon SECOND, a magnifying glass over a result document THIRD. This order is essential.
Caption exactly "按授权操作：先留收据，再发送、查结果" with smaller English "Within authorization: receipt, send, inspect".
Command chip exactly "xx receipt get".
Footer spanning the full width:
"送达不明：先核对，不自动重发"
Smaller English directly beneath: "Uncertain delivery: inspect first. Never resend automatically."
Composition and typography: Large clear sans-serif headings, crisp Chinese characters, restrained monospaced command chips. Each panel has a thin neutral-gray border, black interior and only lightly rounded corners. The icon/cards fill the central panel area while the captions and command chips have separate clean rows beneath. Consistent proportions and baseline alignment. Respect 5% outer margins and prevent any clipped letters. Maintain legibility at a 1000-pixel display width.
Constraints: Pure black, white and neutral grays only. No blue, cyan, magenta, gradients, glow, 3D, cartoon robot, photos, people, watermarks, fake platform screenshots, success claims, automatic sending loop, built-in AI generation, or extra stages. Do not imply every action requires a new approval; say only "within authorization". Do not add explanatory text beyond the exact labels requested.
```

## Workflow rename edit prompt

```text
Edit this exact four-panel workflow artwork for a project rename. Replace EVERY occurrence of the literal product/command name 'xx' with the lowercase name 'xx', including the header, the Chinese and English ownership subtitle, and all four command chips. The four commands must read exactly: 'xx auto suggest', 'xx comment section', 'xx comment check', 'xx receipt get'. Preserve every other Chinese and English word, numbering, icon, panel position, aspect ratio, black-white-gray palette and typography. Do not add or remove any workflow stage. Keep the receipt -> send -> inspect order and the no-automatic-resend footer unchanged. This is only a precise text substitution; preserve the design.
```

## Hero rename edit prompt

```text
Edit this exact README hero for a project rename. Replace only the large lowercase product title 'xx' on the left with the exact lowercase word 'xx' (two lowercase x characters). Keep the same bold white sans-serif type, cap height, left alignment and baseline, allowing the shorter name to occupy less width and leave black space to its right. Preserve the tagline 'X, from your terminal.', the line 'READ / REPLY / RECORD', the white X platform emblem, its terminal frame, the black background, overall 3:1 composition and every other element. No additional changes or text.
```

