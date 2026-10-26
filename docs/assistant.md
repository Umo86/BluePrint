# The exhibitor assistant and the help desk

## Help desk

Exhibitors ask the show team questions from **Help** in the portal (with up to five attachments, PDFs or images). Each question gets a reference such as `HD-000012`. Colleagues at the same company see each other's questions for that show.

The team works through them in **Help desk** (people with the help desk permission):

- **Waiting for the team** (new questions and exhibitor replies), **Waiting for the exhibitor**, **Closed** and **All**, with "Assigned to me" and search.
- Replies are emailed to the exhibitor with a link back to the conversation. **Internal notes** are never shown to exhibitors.
- After replying, choose whether the question waits for the exhibitor (default), closes, or stays with the team. When the exhibitor replies it comes back to the team.
- Assign questions to anyone with the help desk permission; they get an email. Whoever on the help desk answers first is assigned automatically.
- **Saved replies** for answers the team gives often.
- Each exhibitor's record shows its questions and its assistant conversations.

Messages are plain text, so nothing an exhibitor types can run as code. Exhibitors can open up to 10 questions an hour.

## The assistant

The assistant sits in the corner of every portal page ("Ask the assistant") and on its own page. It:

- answers questions from **this show's exhibitor manual** (only the pages the exhibitor's stand type can see), the **answers the team has added**, and **announcements**, with links to the pages;
- knows the exhibitor's own **checklist**, deadlines and what the shop sells, and what they have already ordered;
- **helps fill in forms**: it asks for the answers, then shows "Put these answers in the form". Nothing is saved until the exhibitor presses it, and the exhibitor always checks and sends the form themselves. It never uploads files, signs declarations, sends forms, orders or pays;
- **hands over to the team**: when it cannot help, or the exhibitor asks for a person, it writes the question up and the exhibitor presses "Send to the show team", which opens a help desk question;
- **logs questions it could not answer** under **Assistant** on the show dashboard. Add an answer there and the assistant uses it from then on.

It also **reminds**: when a task reaches a reminder step (14, 7 and 1 days before its deadline, and overdue), the portal home page shows "A reminder from your assistant" once for that step, alongside the reminder emails.

### Safety and privacy

- The assistant only ever works on the signed-in exhibitor's own stand. The stand is fixed by BluePrint, never chosen by the model, so it cannot read or change another exhibitor's data whatever it is asked.
- Anything that changes data (form answers, a question to the team) needs the exhibitor to press a button. Every change is recorded in the audit log.
- Manual pages and form answers are passed to the model as information, and its instructions tell it to ignore any instructions inside them.
- Links in replies are only clickable when they point into BluePrint or to an https website, and links to other websites always show their real address next to the link. Replies cannot contain HTML.
- Limits: 30 questions per person per hour and 150 a day, and a daily ceiling per show (Super admin → Platform settings). If Claude is unavailable, the exhibitor gets a friendly message and nothing is saved.
- Conversations are kept for 12 months by default (Platform settings → Data retention), then deleted by the nightly tidy-up. Only people with the help desk permission can read conversations, and each time they do it is recorded in the audit log. The portal tells exhibitors that the show team can read their conversations.
- Requests go to Anthropic's Claude API. Under Anthropic's [Commercial Terms](https://www.anthropic.com/legal/commercial-terms), Anthropic may not train models on customer content sent through the API, and the data is handled under Anthropic's Data Processing Addendum. Add Anthropic as a sub-processor in your privacy notice and records of processing.

### Setting it up

1. Create an API key in the Claude Console (platform.claude.com) for your organisation's workspace, ideally with a monthly spend limit.
2. Set `ANTHROPIC_API_KEY` in the production environment.
3. Super admin → **Platform settings → Assistant and notices**: switch it on, choose the model and effort, and set the daily ceiling per show.
   - **Claude Sonnet 5.5** (default) gives the best balance of quality, speed and cost.
   - **Claude Haiku 5.5** is the cheapest and fastest.
   - Effort **Low** (default) keeps answers quick and costs down.
4. Each show can switch the assistant off in **Show settings**.

Without an API key, development and test environments use a simple offline stand-in ("practice mode") that searches the manual, so everything can be tried without Claude. Production shows the assistant only when the key is set.

### Costs

Each question usually takes two or three calls to Claude (one to look things up, one to answer). The shared instructions and tool definitions are cached, which makes repeat calls cheaper. The show dashboard's **Assistant** page shows how many questions were asked in the last week. Watch spending in the Claude Console.
