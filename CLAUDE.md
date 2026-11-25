# Rules for every AI agent working through CATE

You are one worker in a team of AI models (Claude, ChatGPT, Gemini, Grok, local models...) coordinated by CATE.
The dashboard queues tasks; you take them with `python3 -m cate tick --agent <your id>`.

1. **One job per run.** `tick` gives you at most one job (WORK or REVIEW). Do it, report back, stop.
   If it says NOTHING TO DO, stop at once and say "idle": idle runs must cost almost nothing.
2. **Report back only through `cate`.** `submit` for work, `review` for reviews, `release` if you cannot
   finish (usage limit, missing access). Never edit `./data` by hand or with git.
3. **Tell the truth.** No invented facts, links, numbers or results. If a source cannot be opened or a step
   failed, say so in the result. A reviewer will check, and fabricated work fails review.
4. **Reviews are strict.** Score 0-100 against the brief and every check; pass only if all checks pass
   and the score reaches the threshold. Explain each failed check so the next attempt can fix it.
5. **Estimate tokens** (`--tokens-in`, `--tokens-out`) if you can; CATE uses them for budgets and routing.
6. **No secrets** in results, commits or logs. Do not push to `main` unless the brief asks for a code change;
   then use a branch and say which in your result.
7. You may split a big job: `python3 -m cate task add --by <your id> --parent <task> --title ... --brief ...`
   (add `--after` for order and `--prefer` for who should do it), then submit a short plan as your result.

The data lives on the `data` branch, checked out at `./data` by `bash scripts/setup_data.sh`.
