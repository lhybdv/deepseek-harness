---
name: meteo-query-normalize
description: Turn a colloquial Chinese question about a township, a farming activity, or a weather hazard into the structured slots the meteorology tools expect, and decide when to ask the user instead of guessing.
when-to-use: Use before answering any farming-suitability, disaster-risk, or weather-consultation question whose wording does not already name a station, a crop, a period, and an activity.
---

# Normalizing a colloquial meteorological question

## What to extract

Read the question and produce these slots. Extract the ones the user actually
stated; never invent a value to fill the schema.

| Slot | What it is | Typical colloquial forms |
|---|---|---|
| station | A township or county the question is about | "临河镇", "咱们这儿", "县里" |
| crop | The crop under discussion | "麦子", "苞米", "大豆" |
| activity | What the user plans to do | "打药", "喷药", "播种", "浇水", "收" |
| period | The time window the question is about | "明天下午", "未来三天", "这阵子", "后天" |
| disaster | A hazard the user is worried about | "暴雨", "冻", "旱", "大风" |
| intent | The kind of answer expected | suitability / risk / observation / advice |

## Rules

1. **Strip the conversational wrapper before searching.** Words like "行不行",
   "咋办", "合适吗", "咱这儿", "请问" carry no domain meaning. They are the single
   largest cause of an empty retrieval result, because no professional document
   contains them.
2. **Keep the domain words.** Disaster names, crop names, activity names and
   weather elements are what reaches the corpus and the rule engine.
3. **Expand activities, not places.** A colloquial activity word maps to the
   formal one ("打药" → "施药", "喷药"), and the expansion lives in the deployment's
   synonym table rather than in this skill. A place name stays as written.
4. **Resolve a relative period against the session's current time**, and keep the
   literal wording in the structured output so a reader can see what was asked.
5. **Carry confirmed slots forward across turns.** When a follow-up omits a slot
   the session already holds — "那后天呢？" after a question that named a station
   and a crop — inherit the held value instead of treating the follow-up as a new
   question. Say which values were inherited so the user can correct them.
6. **Ask when a required slot is missing and no session value covers it.** Ask one
   question at a time, offer the candidates the data actually contains, and never
   pick a station on the user's behalf. A wrong station silently produces a
   confident, useless answer.
7. **State the confidence of the parse.** A question whose station or activity was
   guessed from context is weaker evidence than one that named them, and the
   answer's wording should show that difference.

## Do not

- Do not decide suitability or risk here. This step only produces slots; the
  judgement belongs to the rule engine and to the tool results.
- Do not restate thresholds, levels, or judgement criteria: they live in the
  deployment's versioned data, and a copy here would drift out of date.
