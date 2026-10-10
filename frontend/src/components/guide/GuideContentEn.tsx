import {
  LinkedNotesDiagram,
  TwoStageFlowDiagram,
  InsertionDiagram,
  NoFoldersDiagram,
  AppMapDiagram,
} from "@/components/guide/GuideDiagrams";
import {
  Chapter,
  Code,
  Contents,
  DiagramFrame,
  Eyebrow,
  KeyTable,
  PageSection,
  Points,
  Prose,
  Rhythm,
  Steps,
} from "@/components/guide/GuideParts";

export function GuideContentEn() {
  return (
    <div className="flex flex-col gap-16">
      <section className="flex flex-col gap-5">
        <p className="font-mono text-[10.5px] tracking-[0.25em] text-accent uppercase">Guide</p>
        <h1 className="text-3xl font-extrabold tracking-tight text-balance text-ink">How this app works</h1>
        <Prose>
          One place for a person&rsquo;s notes, plans, records and tracking. Writing down what comes to mind, growing the ideas worth
          keeping, seeing today&rsquo;s schedule and tasks, planning a week of meals and a year of money — things that usually live in
          separate apps, kept together here so they can refer to each other.
        </Prose>
        <Contents
          heading="Contents"
          items={[
            { id: "overview", label: "The shape of it" },
            { id: "setup", label: "Setting up" },
            { id: "rhythm", label: "Daily, weekly, monthly" },
            { id: "write", label: "Write — Dash Off, Zettelkasten, literature" },
            { id: "plan", label: "Plan and record — calendar, projects, meals, training, money" },
            { id: "body", label: "Body and nutrition targets" },
            { id: "find", label: "Find and adjust — discovery, search, settings" },
          ]}
        />
      </section>

      <Chapter id="overview" kicker="Overview" title="The shape of it">
        <Points
          items={[
            {
              title: "The way in is the index",
              body: (
                <>
                  <Code>/</Code> lists every page with a line on what it&rsquo;s for. The top-left corner of every page shows where you are,
                  and pressing it opens the same index.
                </>
              ),
            },
            {
              title: "The seven everyday screens share an icon bar",
              body: (
                <>
                  <Code>/zettelkasten</Code> <Code>/projects</Code> <Code>/calendar</Code> <Code>/meals</Code> <Code>/training</Code>{" "}
                  <Code>/money</Code> <Code>/discovery</Code> sit in one frame with an icon bar down the left that never goes away. Today&rsquo;s schedule,
                  what&rsquo;s left to do, what there is to eat and what it costs get looked at in one sitting, so switching between them is a
                  glance.
                </>
              ),
            },
            {
              title: "The rest are pages you visit and come back from",
              body: "Dash Off, literature notes, search, this guide, settings and a project's detail are plain pages with just the path in the corner.",
            },
            {
              title: "AI runs on your own key",
              body: "The app holds no AI key of its own. It uses the Claude, ChatGPT or Gemini key you add in Settings, and any cost is on that key. Only a few things use it — meal planning, the meal chat and the to-buy list, the training analysis and plan, the weekly money advice, reading PDF statements, and discovery — and everything else works without one.",
            },
            {
              title: "Writing works offline",
              body: "If the connection drops, actions like saving a Dash Off note are held and saved once you're back online. Added to your home screen or Dock, the app also opens with no connection at all.",
            },
            {
              title: "Unsaved text stays on the device",
              body: "What you are typing in a note or task is kept on this device before it is saved. If a save fails — the tab was discarded, or the login ran out — it says so, and reopening the page brings the text back. Signing in again returns you to the page you were on.",
            },
          ]}
        />
      </Chapter>

      <Chapter
        id="setup"
        kicker="Setup"
        title="Setting up"
        intro="None of it is required up front, but the more of it is in, the more the other screens fill themselves. Roughly in order of how much difference each makes."
      >
        <Steps
          items={[
            {
              title: "An AI key (/settings)",
              body: "One of Claude, ChatGPT or Gemini. Meal planning, money advice, PDF statements and discovery run on it.",
            },
            {
              title: "Google Calendar (/settings)",
              body: "The day's events appear in the calendar's timeline. To write the week's meals into Google Calendar, allow write access when connecting.",
            },
            {
              title: "Money basics (/money)",
              body: "Take-home pay, the minimum you can live on and a buffer; rent, subscriptions and instalments; savings goals. With these in, each month's budget fills itself.",
            },
            {
              title: "Body basics and Apple Health (/settings)",
              body: "Height, birth year, sex and activity level give the daily nutrition targets. An iPhone Shortcut that sends weight, active energy and steps each morning (and body fat, with a body composition scale) replaces the estimates with measurements. The steps are on the settings page.",
            },
            {
              title: "Meal preferences (/meals)",
              body: "Weekly food budget, weekday cooking time, shopping day, the day the week starts, dislikes and allergies, how many days you cook.",
            },
            {
              title: "Zotero (/settings, if you work with sources)",
              body: "Literature notes can then look up citations in your Zotero library.",
            },
          ]}
        />
      </Chapter>

      <Chapter id="rhythm" kicker="Rhythm" title="Daily, weekly, monthly" intro="There are a lot of features, but not many by how often you touch them.">
        <Rhythm
          columns={[
            {
              label: "Daily",
              items: [
                "Open /calendar for the day's shape and open tasks",
                "Write whatever comes to mind in /dash-off",
                "Keep the day's task note, marking finished tasks x",
                "Log each meal as eaten, skipped or something else",
                "Enter spending as it happens",
              ],
            },
            {
              label: "Weekly",
              items: [
                "Plan the week by chat in /meals, then shop from the to-buy list",
                "Plan the week's training in /training (analysed from last week's log and the composition trend)",
                "Ask for this week's advice in /money",
                "Promote the Dash Off notes worth keeping (the rest clear themselves after a week)",
              ],
            },
            {
              label: "Monthly",
              items: [
                "The month's budget is made the first time you open it — check it",
                "Import card statements (CSV or PDF)",
                "Look at the year ahead for months that get tight",
              ],
            },
          ]}
        />
      </Chapter>

      <Chapter
        id="write"
        kicker="Write"
        title="Write"
        intro="Write roughly first, then rewrite carefully only what's worth keeping. That two-step is the core of the app."
      >
        <PageSection
          id="dash-off"
          path="/dash-off"
          name="Dash Off"
          lead="Where things go down in the order they arrive, without worrying about form. Notes stack up in time order and can be added to in place."
        >
          <Points
            items={[
              {
                title: "Meant to be thrown away",
                body: "A Dash Off note that isn't attached to a project is archived automatically seven days after it was written. Rewrite the ones worth keeping in the Zettelkasten, or attach them to a project. It keeps the desk from silting up.",
              },
              {
                title: "Attach a project and a source",
                body: "Open a note to say which project it belongs to and which literature note it came from.",
              },
              {
                title: "Code, diagrams, images",
                body: (
                  <>
                    Wrap text in <Code>```language</Code> for code, <Code>```mermaid</Code> for a diagram, and use <Code>![](URL)</Code> for
                    an image.
                  </>
                ),
              },
              {
                title: "Discovery candidates",
                body: "Notes you choose in /discovery get related sources and news the AI found hanging underneath them.",
              },
            ]}
          />
        </PageSection>

        <PageSection
          id="zettelkasten"
          path="/zettelkasten"
          name="Zettelkasten"
          lead={
            <>
              Where you pick the scratch notes worth growing, rewrite them in your own words, and file them between the notes they belong
              with. It&rsquo;s the method practiced by sociologist Niklas Luhmann and popularized by Sönke Ahrens&rsquo; book{" "}
              <em className="not-italic">How to Take Smart Notes</em> (Zettelkasten is German for &ldquo;slip box&rdquo;). The rules are
              simple, and almost all of them are about connecting notes.
            </>
          }
        >
          <div className="flex flex-col gap-10 pt-2">
            <div className="flex flex-col gap-4">
              <Eyebrow>A note means something once it&rsquo;s connected</Eyebrow>
              <Prose>
                The value isn&rsquo;t in the notes but in the <strong className="text-ink">links between them</strong>. A single note
                becomes knowledge when it&rsquo;s tied to others.
              </Prose>
              <DiagramFrame>
                <LinkedNotesDiagram leftLabel="Notes alone" rightLabel="Notes, linked" />
              </DiagramFrame>
            </div>

            <div className="flex flex-col gap-4">
              <Eyebrow>Two stages — fleeting and permanent</Eyebrow>
              <Prose>
                Capturing fragments of thought quickly is one step; choosing some of them, rewriting them in your own words and linking them
                to what&rsquo;s already there is another. Fleeting notes can be thrown away. Only what&rsquo;s worth it is rewritten and kept.
              </Prose>
              <DiagramFrame>
                <TwoStageFlowDiagram fleetingLabel="Fleeting notes" arrowLabel="Select & rewrite" permanentLabel="Permanent note, linked" />
              </DiagramFrame>
            </div>

            <div className="flex flex-col gap-4">
              <Eyebrow>Choose where a note goes by what it relates to. No folders</Eyebrow>
              <Prose>
                Deciding where a permanent note goes is deciding where a new idea sits among everything you already know. Notes form one
                sequence and link into a web; a few index entries for the places you return to often are all the structure needed.
              </Prose>
              <DiagramFrame>
                <NoFoldersDiagram folderLabel="Folders (skip this)" indexLabel="A few index entries" />
              </DiagramFrame>
            </div>

            <div className="flex flex-col gap-4">
              <Eyebrow>Linking keeps old notes alive</Eyebrow>
              <Prose>
                A permanent note only goes in once it links to at least one existing note or index entry. That small step is what stops old
                notes being stranded and forgotten. Luhmann gave his paper slips addresses like <Code>21/3d7a26</Code> so a new slip could
                always go between two existing ones — branching the thought without renumbering anything.
              </Prose>
              <DiagramFrame>
                <InsertionDiagram label="A new note can always land between A and B" />
              </DiagramFrame>
            </div>

            <div className="flex flex-col gap-4">
              <Eyebrow>On this screen</Eyebrow>
              <DiagramFrame>
                <AppMapDiagram
                  dashOffLabel="① Dash Off"
                  promoteLabel="Select & promote"
                  zettelkastenLabel="② Zettelkasten"
                  literatureLabel="Literature memo (either side)"
                />
              </DiagramFrame>
              <Steps
                items={[
                  {
                    title: "Pick scratch notes in the right column (③)",
                    body: "Select one or several and create a permanent note from them. You can also write one directly, with no scratch note behind it (“+ Permanent note”).",
                  },
                  {
                    title: "Rewrite in the middle (②)",
                    body: "Give it a title and put it in your own words. Link it to at least one other permanent note or index entry, with a word on how they relate. Literature notes on the source scratch notes carry over.",
                  },
                  {
                    title: "Choose its place in the left column (①)",
                    body: "Drill into the piles and tap the gap between two existing notes; the new one goes there. Once done, the source scratch notes are cleared as promoted.",
                  },
                  {
                    title: "Keep the index small",
                    body: "Add a keyword to the index only for the notes you really do return to. The index is a way in; from there, follow the links.",
                  },
                ]}
              />
              <Prose>It&rsquo;s a three-column screen, so on a phone, turn it sideways.</Prose>
            </div>
          </div>
        </PageSection>

        <PageSection
          id="literature"
          path="/literature"
          name="Literature notes"
          lead="Where what a book or paper said is kept, in your own words. One summary per source, which both scratch and permanent notes can cite."
        >
          <Points
            items={[
              {
                title: "However often a source comes up, there's one summary",
                body: "The summary is shared by every note that cites it, and you can see which notes those are.",
              },
              {
                title: "Citations from Zotero",
                body: "With Zotero connected, look a source up and use its citation as is. One that isn't in the library can be added to Zotero on the spot, if the key has write access.",
              },
            ]}
          />
        </PageSection>
      </Chapter>

      <Chapter
        id="plan"
        kicker="Plan & record"
        title="Plan and record"
        intro="How today goes, what to eat this week, what there is to spend this month. Decide, then keep a record of what actually happened."
      >
        <PageSection
          id="calendar"
          path="/calendar"
          name="Calendar"
          lead="Today's dashboard: the shape of the day, open tasks, meals and nutrition, and spending, on one screen. Step to the days either side."
        >
          <Points
            items={[
              {
                title: "The day's timeline",
                body: "A 24-hour axis with your Google Calendar events, the meal slots from the meal plan, and time you've blocked out. On today, a line marks the current time.",
              },
              {
                title: "Open tasks",
                body: "Lines starting “- ” in your projects' task notes. Indentation becomes nesting. Mark a task done by changing it to x in the note.",
              },
              {
                title: "Block out time",
                body: "A start time and a length put a block on the day. The title can be picked from your open tasks.",
              },
              {
                title: "Today's meals",
                body: "Log each planned meal as eaten, skipped or something else, and the target, the plan's total and what you actually had line up. The actual figure counts only meals marked eaten.",
              },
              {
                title: "Today's spending",
                body: "An amount and a category is all it takes. It also shows how far through this month's food budget you are.",
              },
              {
                title: "Timeline view",
                body: "Switch at the top right for a month of project bars and the days with notes. Tap a day to open that day's task notes for every project. Future months can be opened too, and written into.",
              },
            ]}
          />
        </PageSection>

        <PageSection
          id="projects"
          path="/projects"
          name="Projects"
          lead="The unit of what you're working on: a ladder of goals and a task note for each day. There's always a default project to start with."
        >
          <Points
            items={[
              {
                title: "A goal ladder (optional)",
                body: "Ultimate goal → 3 years → 2 → 1 → 3 months → 1 month → today. If you use it, the ultimate goal and today's goal are required. It's there to see how the far goal reaches today's actions, top to bottom.",
              },
              {
                title: "A task note per day",
                body: "One per project per day. Written in the bullet journal notation below, its tasks show up on the calendar.",
              },
              {
                title: "Linked notes",
                body: "Every scratch and permanent note attached to the project.",
              },
              {
                title: "Closing is manual",
                body: "A project never closes on its own when a goal date passes. Closing it stops its timeline bar there and archives the scratch notes attached to it.",
              },
            ]}
          />
          <Eyebrow>Bullet journal notation</Eyebrow>
          <KeyTable
            mono
            rows={[
              ["-", "Task (open — shows on the calendar)"],
              ["x", "Done"],
              [">", "Migrated to the next day"],
              ["<", "Scheduled"],
              ["o", "Event"],
              ["~", "Note"],
              ["*", "Priority"],
              ["!", "Inspiration"],
            ]}
          />
          <Prose>A collapsed legend can be shown beside the notes (turn it on or off in Settings).</Prose>
          <Prose>
            On a phone, a row of keys sits on top of the keyboard while you write a note: indent (⇥), outdent (⇤), and the symbols above. Each acts on the line the cursor is on (or every selected line), so pressing “x” on “- send the files” marks it done. Pressing the same symbol again takes it off.
          </Prose>
        </PageSection>

        <PageSection
          id="meals"
          path="/meals"
          name="Meals"
          lead="A week of meals and the list of what to buy for it. The week is made by chat — say how you want it — and changed the same way, a day at a time. The AI plans within your nutrition targets, weekly budget and cooking time; the app then recalculates the result and tells you where it misses."
        >
          <Points
            items={[
              {
                title: "Cook, batch, ready-made",
                body: "Set how many days you cook and how many meals can be frozen or ready-made, and the plan stays within that. Batch-cooked and ready-made meals count only their reheating time, and any weekday over your cooking time is flagged.",
              },
              {
                title: "Where it misses",
                body: "Each day's energy and protein, and the shopping estimate, are recalculated and flagged if they're off target. Ask the chat to change that day.",
              },
              {
                title: "Actual food spending",
                body: "What went on the food category that week (entered by hand and imported together), beside the weekly budget.",
              },
              {
                title: "Write to Google Calendar",
                body: "Put the week's meals into your calendar at the meal times you've set.",
              },
              {
                title: "Make and change it by chat",
                body: "Ask “plan this week — I batch-cook on Monday and Thursday” for a whole week, or write “fish for dinner on the 14th”, “they were out of chicken, so I bought pork” or “eating out on Thursday” for a proposal covering the meals from today on that haven't been eaten. Tapping a day, an empty meal, or “Ask about this meal” in a recipe puts its date in the box. Nothing changes until you check the meal and inventory changes and press Apply — then the calendar is rewritten too.",
              },
              {
                title: "To-buy list",
                body: "Once the meals are settled, choose the day you shop and how many days to buy for, and press “Make the to-buy list”. It lists what those days' recipes need, less what's in the inventory. If the meals change, the list offers to remake itself. Tick what you buy and it goes into the inventory; press “Done shopping” to close it.",
              },
              {
                title: "Inventory",
                body: "Always on screen, split into fridge, freezer and cupboard, with amounts and places editable in place. The next plan and the next to-buy list both use what's at home first.",
              },
            ]}
          />
        </PageSection>

        <PageSection
          id="training"
          path="/training"
          name="Training"
          lead="Your target body composition next to the current one, and a week of training towards it written by the AI trainer. Each week it analyses how the composition moved and what last week's log says, and adjusts the next plan."
        >
          <Points
            items={[
              {
                title: "Now and goal",
                body: "Body fat, lean mass, fat mass and weight, now (seven-day average) against the goal, with the gap. Set the target body fat — and a target lean mass, if you want one — here; the nutrition targets for meals follow it.",
              },
              {
                title: "Week by week",
                body: "Twelve weeks of seven-day averages, each with its change from the week before — to see whether it was fat or lean mass that moved, not just weight.",
              },
              {
                title: "Analyse, then plan",
                body: "“Plan this week” has the trainer read the composition trend and last week's sessions, effort and notes, write an analysis, and plan the week from it within your days, minutes, equipment and injuries. Replanning mid-week keeps the days already past as logged.",
              },
              {
                title: "Log it",
                body: "From the day of a session on, mark it done or skipped, give the effort (1–10) and note what you actually did. That's what next week's analysis reads. Meal planning also takes training days into account for protein and carbohydrate.",
              },
            ]}
          />
        </PageSection>

        <PageSection
          id="money"
          path="/money"
          name="Money"
          lead="What there is to spend this month, what's been spent, and how the year ahead looks — the record and the plan on one screen."
        >
          <Points
            items={[
              {
                title: "The month's plan fills itself",
                body: "Take-home pay minus fixed costs, instalments, savings and the buffer is what there is to live on. That's split across categories the way this household actually spends, the first time you open a new month. Any figure can be edited.",
              },
              {
                title: "Allocation by category",
                body: "Each category's spending against its budget, with a tick for how far through the month you are: a bar past the tick is on course to overrun. Spending in a category the plan has no line for appears as “no budget”, with a box to give it one.",
              },
              {
                title: "Fixed costs, instalments, savings goals",
                body: "Give an instalment its last month and a goal its amount and date. A goal's remaining amount, spread over the months left, goes into the plan as a monthly contribution.",
              },
              {
                title: "The year ahead",
                body: "Twelve months from now. The month an instalment ends or a goal is reached shows as more to live on. Months that fall below your minimum are flagged — but savings are never cut on your behalf; that's your call.",
              },
              {
                title: "This week's accountant (AI)",
                body: "Given the last seven days of spending and this month's budget, it says specifically what could come down and by how much. Once a week.",
              },
              {
                title: "Statement import (CSV or PDF)",
                body: "Bring in card and bank statements. A CSV's column mapping is remembered, so the next one is just a paste. A PDF is read by the AI and checked against the total printed on the statement. Either way you see the rows before anything is written; lines already imported aren't added twice, and a line matching something entered by hand (same day, same amount) can replace it. Categories you choose while importing are remembered for next time.",
              },
            ]}
          />
        </PageSection>
      </Chapter>

      <Chapter
        id="body"
        kicker="Body"
        title="Body and nutrition targets"
        intro="The target figures in meals and on the calendar come from here. They're set in Settings and updated each morning from Apple Health."
      >
        <Points
          items={[
            {
              title: "Daily nutrition targets",
              body: "Energy, protein, fat, carbohydrate, fibre and salt. With lean mass from a body composition scale, basal metabolism and protein are worked out from lean mass rather than body weight. Measured energy expenditure is used when it's available.",
            },
            {
              title: "Body fat target, set automatically",
              body: "Taken from the athletic range for your sex. Your current reading then decides the direction — lose fat, build lean mass, or hold — and, if losing, roughly how many weeks it takes. Enter your own on /training to override it.",
            },
            {
              title: "No crash diets",
              body: "A target pace that's too fast is held back so intake never drops below basal metabolism. If you have a condition, or advice from a doctor or dietitian, follow that instead.",
            },
          ]}
        />
      </Chapter>

      <Chapter id="find" kicker="Find & adjust" title="Find and adjust">
        <PageSection
          id="discovery"
          path="/discovery"
          name="Discovery"
          lead="For the scratch notes you choose, the AI searches the web for related sources and news. It spends your AI credit, so notes are opted in one at a time, and nothing runs automatically by default."
        >
          <Points
            items={[
              {
                title: "How often",
                body: "Off, once a day, or twice a day. “Search now” works any time.",
              },
              {
                title: "Using what it finds",
                body: "Candidates appear under the note as “Related”. Add one as a literature note, or start a new note from it.",
              },
            ]}
          />
        </PageSection>

        <PageSection
          id="search"
          path="/search"
          name="Search"
          lead="Across scratch and permanent notes, narrowing as you type."
        />

        <PageSection
          id="settings"
          path="/settings"
          name="Settings"
          lead="AI key, Google Calendar, Zotero, body basics and the Apple Health intake, and whether the bullet journal legend shows. Language and light/dark are in the menu at the top right."
        />
      </Chapter>

      <section className="flex flex-col gap-2 border-t border-line pt-8">
        <p className="font-mono text-[10.5px] text-ink-faint">
          Further reading: Sönke Ahrens, <em className="not-italic">How to Take Smart Notes</em>.
        </p>
      </section>
    </div>
  );
}
