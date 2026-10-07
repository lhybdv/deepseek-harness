Northeast China agricultural meteorology demonstration corpus

These eight plain-text source documents are the versioned literature set for the meteo demonstration. They cover spring sowing and autumn harvest patterns, maize, soybean and rice management, spring drought, cold injury, early frost and rainstorm waterlogging. Each blank-line-delimited paragraph occupies one physical line so chunk offsets remain directly traceable to the source.

The directory is apps/cli/config/examples/meteo/corpus. Index its files into the active demonstration's <DSH_HOME>/meteo/corpus.v1.sqlite through the registered corpus_ingest tool; the tool does not read files itself. Before replacing an existing corpus, list current documents with the corpus seam and remove each old document through its remove API, then ingest this set. Search results and citations identify the indexed title, zero-based chunk ordinal and character range.

The text is operational regional guidance, not a substitute for current county agricultural meteorology bulletins, cultivar-specific thresholds or field inspection. Thresholds are screening indicators and should be interpreted with crop stage, soil, terrain and the current forecast.
