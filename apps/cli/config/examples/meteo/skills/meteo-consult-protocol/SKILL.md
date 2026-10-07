---
name: meteo-consult-protocol
description: How to read a meteorological consultation result, present its evidence honestly, and separate what the data supports from what it does not.
when-to-use: Use when answering any observation, forecast, farming-suitability, or disaster-risk question whose answer comes from the meteorology consultation tool.
---

# Answering from a consultation result

## Order of reading

Read the result in the order the tool produced it, and build the answer in the
same order:

1. **What was understood.** The parsed station, crop, activity and period. Open
   the answer by naming the subject you are answering about — the user needs to
   see the interpretation before the conclusion, because that is where a
   misunderstanding is cheapest to catch.
2. **What was observed and forecast.** The measured and predicted values the
   judgement rests on. Cite the element and the time window, not a vague "the
   weather".
3. **What the rules concluded.** The suitability verdict or risk level together
   with the specific criteria that fired. A verdict without its triggering
   criteria is not an answer.
4. **What the corpus says.** The professional material that explains or qualifies
   the verdict, cited by chunk. See `meteo-citation-policy`.
5. **What follows from it.** The advice, stated as something the user can act on.

## Document products

When `meteo_document` returns 文档内容, include the title and ordered section text in your answer so the user can read the document; do not replace it with a lifecycle summary. If the result marks the content truncated, say so and offer to read the remainder. After publishing, state the returned version and artifact path, and say plainly that the file exists there. Report each transition with its returned actor and instant. For a rejection, quote the returned reviewer note and say what the draft now needs. Never invent document content, citations, or numbers beyond the tool result.

## Rules

## Place coverage

This deployment covers 五常市, 榆树市, and 昌图县, and also publishes city stations for 哈尔滨市, 长春市 and 沈阳市. For a bare covered city or county, use `meteo_station_lookup` to resolve its own published seat station, then use that station's returned data directly. For a place outside coverage, do not ask the user which station or for a station id. In one short sentence, state the covered counties and city stations, name the nearest covered point only when the question implies a nearby area and published data supports that choice, then offer to continue using it. Never invent a station, reading, or administrative mapping.

1. **Report the rule version the result carries.** If the deployment's thresholds
   changed, an answer is only reconcilable with a later one when both name the
   version they used.
2. **Distinguish the three strengths of statement.** A measured value, a forecast
   value, and a rule verdict are different kinds of claim. Do not present a
   forecast as an observation, and do not present a rule verdict as a measurement.
3. **State the period a verdict covers.** Suitability is always relative to a
   window; "suitable" without a window is not usable advice.
4. **Say what the data does not cover.** When the station has no observation for
   part of the period, when the forecast horizon ends before the question does,
   or when the corpus holds nothing on the topic, say so plainly rather than
   filling the gap with general knowledge presented as local advice.
5. **Prefer the narrow claim.** When the evidence supports "no rain is forecast in
   this window" but not "it is safe to spray", answer the narrower one and name
   what would be needed to answer the wider one.
6. **Never re-run judgement in prose.** If the rule engine says unsuitable and the
   conditions look marginal to you, report the verdict and the margin; do not
   overrule the rules with your own reading of the numbers.

## Do not

- Do not restate numeric thresholds from memory: they belong to the deployment's
  versioned data, and a paraphrase that drifts is worse than no number.
- Do not answer a disaster-risk question without the criteria that drove the level.
- Do not present an empty retrieval result as "no relevant guidance exists" —
  say that the corpus returned nothing for the query, which is a different and
  actionable statement.
