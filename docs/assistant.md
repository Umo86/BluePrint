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
- **hands over to the team**: when it cannot help, or the exhibitor asks for a person, it writes the question up. The exhibitor can add a phone number and a good time to call, sees when the team will reply (from the show's office hours), and presses "Send to the show team", which opens a help desk question;
- **logs questions it could not answer** under **AI assistant** on the show dashboard. Add an answer there and the assistant uses it from then on.

It also **reminds**: when a task reaches a reminder step (14, 7 and 1 days before its deadline, and overdue), the portal home page shows "A reminder from your assistant" once for that step, alongside the reminder emails.

### Safety and privacy

- The assistant only ever works on the signed-in exhibitor's own stand. The stand is fixed by BluePrint, never chosen by the model, so it cannot read or change another exhibitor's data whatever it is asked.
- Anything that changes data (form answers, a question to the team) needs the exhibitor to press a button. Every change is recorded in the audit log.
- Manual pages and form answers are passed to the model as information, and its instructions tell it to ignore any instructions inside them.
- Links in replies are only clickable when they point into BluePrint or to an https website, and links to other websites always show their real address next to the link. Replies cannot contain HTML.
- Limits: 30 questions per person per hour and 150 a day, and 3,000 per show per day, by default (Super admin → **AI assistant**). Each show can set a lower daily limit. If Claude is unavailable, the exhibitor gets a friendly message and nothing is saved.
- The organiser's and the show team's own instructions (house rules) are added after BluePrint's built-in rules, which always win: the assistant still answers only from the show's own information and never acts for anyone else.
- Conversations are kept for 12 months by default (Platform settings → Data retention), then deleted by the nightly tidy-up. Only people with the help desk permission can read conversations, and each time they do it is recorded in the audit log. The portal tells exhibitors that the show team can read their conversations.
- Requests go to Anthropic's Claude API. Under Anthropic's [Commercial Terms](https://www.anthropic.com/legal/commercial-terms), Anthropic may not train models on customer content sent through the API, and the data is handled under Anthropic's Data Processing Addendum. Add Anthropic as a sub-processor in your privacy notice and records of processing.

### Setting it up

1. Create an API key in the Claude Console (platform.claude.com) for your organisation's workspace, ideally with a monthly spend limit.
2. Set `ANTHROPIC_API_KEY` in the production environment (in Vercel, mark it **Sensitive**), then redeploy.
3. Super admin → **AI assistant**:
   - **Check the connection** sends Claude one tiny question with the chosen model and says plainly whether the key, the model and the account work.
   - Switch it on for every show, choose the model and effort, set the limits, and add **instructions for every show** (for example, how to refer to your organisation, or what never to promise).
   - **Claude Sonnet 5.5** (default) gives the best balance of quality, speed and cost. **Claude Haiku 5.5** is the cheapest and fastest. Effort **Low** (default) keeps answers quick and costs down.
   - **Usage and costs** shows, for each show over the last 30 days, the questions asked, people helped, test questions and the estimated spend.
4. Each show's **AI assistant** section on its dashboard:
   - **Overview**: questions this week and today against the daily limit, estimated spend, and the questions it could not answer.
   - **Settings** (people who can edit content): switch it on or off for the show, give it a **name** (for example "BuildExpo helper"), a **greeting** (`{first_name}` becomes the exhibitor's first name; empty uses the automatic greeting that mentions their next deadline), up to four **suggested questions**, **house rules** for the show, a lower **daily limit**, and the team's **office hours**, usual reply time and whether to ask for a phone number. A preview shows what exhibitors see.
   - **Knowledge**: what it reads (published manual pages, announcements) and the answers the team has added.
   - **Test chat** (people who can manage exhibitors): try the assistant as any of the show's exhibitors before they use it, even while it is switched off for the show. It answers from that exhibitor's checklist, forms and orders, but nothing is saved for them, nothing goes to the help desk, and nothing is logged as unanswered. Test chats use real Claude credit and count towards the daily limit.
   - **Conversations** (help desk permission): exhibitors' conversations. Test chats are not listed.

Cloning an edition keeps its assistant set-up. Without an API key, development and test environments use a simple offline stand-in ("practice mode") that searches the manual, so everything can be tried without Claude. Production shows the assistant only when the key is set.

### Costs

Each question usually takes two or three calls to Claude (one to look things up, one to answer). The built-in rules, the tools and each show's house rules are cached, which makes repeat calls much cheaper. Spend is estimated from the tokens Claude reports at Anthropic's list prices (US dollars) and shown per show and in total; the Claude Console shows the exact bill.
