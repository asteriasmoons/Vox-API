#!/usr/bin/env node
//
// sim.mjs — multiplayer test harness for Lumey buddy reads and sprints.
//
// The API has no auth middleware: every route reads `userId` straight from the
// query string or body. That means this script can act as any number of fake
// readers, so you can exercise every multi-person flow on your own.
//
// Because the service emits socket events, anything you do here shows up live
// in the app — post a join request and watch it appear in Join Requests.
//
// Usage:
//   node sim.mjs <command> [args]
//   node sim.mjs help
//
// Target API (defaults to production Railway):
//   API=http://localhost:3000 node sim.mjs board
//
// Your own Apple ID, used by commands that act "as you":
//   ME=001664.xxx node sim.mjs mine
//

const API = process.env.API ?? "https://vox-api-production-31fd.up.railway.app";
const ME = process.env.ME ?? "001664.f2fefbb84f024544b98e865fa6c6b49e.1524";

// ---------------------------------------------------------------------------
// Fake readers
// ---------------------------------------------------------------------------
// Stable IDs so repeated runs reuse the same people instead of piling up new
// members. Reference them by short name on the command line.

const BOTS = {
  ivy: { userId: "sim-ivy-0001", displayName: "Ivy" },
  wren: { userId: "sim-wren-0002", displayName: "Wren" },
  juno: { userId: "sim-juno-0003", displayName: "Juno" },
  cass: { userId: "sim-cass-0004", displayName: "Cass" },
};

function bot(name) {
  const found = BOTS[String(name ?? "").toLowerCase()];
  if (!found) {
    fail(
      `Unknown reader "${name}". Available: ${Object.keys(BOTS).join(", ")}`,
    );
  }
  return found;
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function call(method, path, { query, body } = {}) {
  const url = new URL(API + path);
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  }

  const res = await fetch(url, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let payload;
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { raw: text };
  }

  if (!res.ok) {
    const detail = payload?.error ?? payload?.raw ?? res.statusText;
    fail(`${method} ${path} → ${res.status} ${detail}`);
  }

  return payload;
}

const get = (path, query) => call("GET", path, { query });
const post = (path, body) => call("POST", path, { body });
const del = (path, query) => call("DELETE", path, { query });

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const green = (s) => `\x1b[32m${s}\x1b[0m`;
const yellow = (s) => `\x1b[33m${s}\x1b[0m`;

function fail(message) {
  console.error(`\x1b[31m✗\x1b[0m ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`${green("✓")} ${message}`);
}

// Print ids in full — they get pasted straight into the next command.
function shortId(id) {
  return dim(String(id ?? ""));
}

// ---------------------------------------------------------------------------
// Buddy reads
// ---------------------------------------------------------------------------

async function cmdBoard() {
  const { announcements } = await get("/api/buddy/announcements", {
    userId: ME,
  });

  if (!announcements?.length) {
    console.log(dim("Board is empty."));
    return;
  }

  for (const a of announcements) {
    const spots = a.spotsLeft ?? "?";
    const pending = a.pendingMemberCount ? yellow(` ${a.pendingMemberCount} waiting`) : "";
    console.log(
      `${shortId(a._id)}  ${bold(a.bookTitle)} ${dim("by " + a.ownerDisplayName)}  ${spots} spot(s)${pending}`,
    );
  }
}

async function cmdPost(who, ...titleParts) {
  const reader = bot(who);
  const bookTitle = titleParts.join(" ") || "A Test Read";

  const { announcement } = await post("/api/buddy/announcements", {
    ownerUserId: reader.userId,
    ownerDisplayName: reader.displayName,
    bookTitle,
    bookAuthor: "Sim Author",
    message: `${reader.displayName} is looking for a buddy.`,
    maxMembers: 4,
  });

  ok(`${reader.displayName} posted ${bold(bookTitle)}  ${shortId(announcement._id)}`);
}

async function cmdRequest(who, announcementId) {
  const reader = bot(who);
  if (!announcementId) fail("Need an announcement id. Run `board` to list them.");

  const { group } = await post("/api/buddy/groups/request", {
    announcementId,
    requesterUserId: reader.userId,
    requesterDisplayName: reader.displayName,
  });

  const me = group.members.find((m) => m.userId === reader.userId);
  ok(
    `${reader.displayName} → ${bold(group.bookTitle)} (${me?.status})  group ${shortId(group._id)}`,
  );
  if (me?.status === "pending") {
    console.log(dim("  Check Join Requests in the app — it should be there now."));
  }
}

async function cmdRespond(accept, actor, groupId, who) {
  const target = bot(who);
  const actorId = actor === "me" ? ME : bot(actor).userId;
  if (!groupId) fail("Need a group id. Run `mine` to list your groups.");

  const { group } = await post(`/api/buddy/groups/${groupId}/respond`, {
    actorUserId: actorId,
    targetUserId: target.userId,
    accept,
  });

  const state = group.members.find((m) => m.userId === target.userId)?.status;
  ok(`${accept ? "Accepted" : "Declined"} ${target.displayName} → ${state}`);
}

async function cmdSay(who, groupId, ...words) {
  const reader = bot(who);
  if (!groupId) fail("Need a group id.");
  const text = words.join(" ") || "Hello from the sim.";

  await post(`/api/buddy/groups/${groupId}/messages`, {
    senderUserId: reader.userId,
    senderDisplayName: reader.displayName,
    type: "text",
    text,
  });

  ok(`${reader.displayName}: ${text}`);
  console.log(dim("  Should appear instantly if you have the chat open."));
}

async function cmdProgress(who, groupId, chapter) {
  const reader = bot(who);
  if (!groupId) fail("Need a group id.");

  await post(`/api/buddy/groups/${groupId}/messages`, {
    senderUserId: reader.userId,
    senderDisplayName: reader.displayName,
    type: "progress_update",
    text: `${reader.displayName} is on chapter ${chapter ?? 1}.`,
    progressChapter: Number(chapter ?? 1),
  });

  ok(`${reader.displayName} posted progress: chapter ${chapter ?? 1}`);
}

async function cmdLeave(who, groupId) {
  const userId = who === "me" ? ME : bot(who).userId;
  if (!groupId) fail("Need a group id.");

  await post(`/api/buddy/groups/${groupId}/leave`, { userId });
  ok(`${who} left ${shortId(groupId)}`);
  console.log(
    dim("  If they posted the announcement, it is now closed — reopen with `reopen <id>`."),
  );
}

async function cmdMine(who = "me") {
  const userId = who === "me" ? ME : bot(who).userId;
  const { groups } = await get("/api/buddy/groups/mine", { userId });

  if (!groups?.length) {
    console.log(dim("Not in any groups."));
    return;
  }

  for (const g of groups) {
    const joined = g.members.filter((m) => m.status === "joined");
    const pending = g.members.filter((m) => m.status === "pending");
    console.log(
      `${shortId(g._id)}  ${bold(g.bookTitle)}  ${joined.length}/${g.maxMembers} joined` +
        (pending.length ? yellow(`  ${pending.length} pending`) : ""),
    );
    for (const m of joined) console.log(dim(`    joined   ${m.displayName}`));
    for (const m of pending) console.log(yellow(`    pending  ${m.displayName}`));
  }
}

async function cmdReopen(announcementId) {
  if (!announcementId) fail("Need an announcement id.");
  const { announcement } = await post(
    `/api/buddy/announcements/${announcementId}/reopen`,
    { userId: ME },
  );
  ok(`Reopened ${bold(announcement.bookTitle)} (${announcement.status})`);
}

// ---------------------------------------------------------------------------
// Sprints
// ---------------------------------------------------------------------------

async function cmdSprint() {
  const { sprint } = await get("/api/sprint/active");
  if (!sprint) {
    console.log(dim("No active sprint."));
    return;
  }

  console.log(
    `${shortId(sprint._id)}  ${bold(sprint.status)}  ${sprint.durationMinutes}m  ` +
      dim(`started by ${sprint.startedByDisplayName}`),
  );
  console.log(dim(`  ends ${new Date(sprint.endsAt).toLocaleTimeString()}`));

  for (const p of sprint.participants ?? []) {
    const done =
      p.endPage != null
        ? green(`${p.pagesRead} pages, ${p.pointsAwarded} pts`)
        : yellow("reading");
    console.log(`    ${p.displayName}  from p.${p.startPage}  ${done}`);
  }
}

async function cmdSprintStart(who, minutes = 5, startPage = 1) {
  const reader = bot(who);
  const { sprint } = await post("/api/sprint/start", {
    userId: reader.userId,
    displayName: reader.displayName,
    durationMinutes: Number(minutes),
    startPage: Number(startPage),
  });

  ok(
    `${reader.displayName} started a ${minutes}m sprint  ${shortId(sprint._id)} (${sprint.status})`,
  );
}

async function cmdSprintJoin(who, sprintId, startPage = 1) {
  const reader = bot(who);
  if (!sprintId) fail("Need a sprint id. Run `sprint` to see the active one.");

  const { sprint } = await post(`/api/sprint/${sprintId}/join`, {
    userId: reader.userId,
    displayName: reader.displayName,
    startPage: Number(startPage),
  });

  ok(`${reader.displayName} joined from page ${startPage} (${sprint.participants.length} readers)`);
}

async function cmdSprintSubmit(who, sprintId, endPage) {
  const reader = bot(who);
  if (!sprintId) fail("Need a sprint id.");
  if (endPage == null) fail("Need an end page.");

  const { sprint } = await post(`/api/sprint/${sprintId}/submit`, {
    userId: reader.userId,
    endPage: Number(endPage),
  });

  const me = sprint.participants.find((p) => p.userId === reader.userId);
  ok(`${reader.displayName} submitted p.${endPage} → ${me?.pagesRead} pages, ${me?.pointsAwarded} pts`);
}

async function cmdSprintSay(who, ...words) {
  const reader = bot(who);
  const text = words.join(" ") || "Sprinting!";

  await post("/api/sprint/messages", {
    senderUserId: reader.userId,
    senderDisplayName: reader.displayName,
    text,
  });

  ok(`${reader.displayName} (sprint chat): ${text}`);
}

async function cmdLeaderboard() {
  const { leaderboard } = await get("/api/sprint/leaderboard");
  if (!leaderboard?.length) {
    console.log(dim("Leaderboard is empty."));
    return;
  }
  leaderboard.forEach((entry, i) => {
    console.log(
      `${String(i + 1).padStart(2)}. ${bold(entry.displayName)}  ${entry.totalPoints} pts  ` +
        dim(`${entry.totalPagesRead} pages / ${entry.sprintsParticipated} sprints`),
    );
  });
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** Ivy posts a read, Wren and Juno request to join it. */
async function cmdScenarioRequests() {
  console.log(bold("\nScenario: two readers request to join one announcement\n"));

  const { announcement } = await post("/api/buddy/announcements", {
    ownerUserId: BOTS.ivy.userId,
    ownerDisplayName: BOTS.ivy.displayName,
    bookTitle: "The Sim Chronicles",
    bookAuthor: "Sim Author",
    message: "Looking for two buddies!",
    maxMembers: 4,
  });
  ok(`Ivy posted The Sim Chronicles  ${shortId(announcement._id)}`);

  for (const name of ["wren", "juno"]) {
    const reader = BOTS[name];
    const { group } = await post("/api/buddy/groups/request", {
      announcementId: announcement._id,
      requesterUserId: reader.userId,
      requesterDisplayName: reader.displayName,
    });
    const state = group.members.find((m) => m.userId === reader.userId)?.status;
    ok(`${reader.displayName} requested → ${state}   group ${shortId(group._id)}`);
  }

  console.log(
    dim("\nIvy now has two pending requests. To approve as Ivy:\n") +
      `  node sim.mjs accept ivy <groupId> wren\n`,
  );
}

/** You post a read, then a bot requests to join it — exercises YOUR approve UI. */
async function cmdScenarioJoinMe(...titleParts) {
  const bookTitle = titleParts.join(" ") || "Your Test Read";
  console.log(bold(`\nScenario: Wren asks to join your read\n`));

  const { announcement } = await post("/api/buddy/announcements", {
    ownerUserId: ME,
    ownerDisplayName: "You",
    bookTitle,
    bookAuthor: "Sim Author",
    message: "Testing the approve flow.",
    maxMembers: 4,
  });
  ok(`Posted ${bold(bookTitle)} as you  ${shortId(announcement._id)}`);

  const { group } = await post("/api/buddy/groups/request", {
    announcementId: announcement._id,
    requesterUserId: BOTS.wren.userId,
    requesterDisplayName: BOTS.wren.displayName,
  });
  ok(`Wren requested to join  group ${shortId(group._id)}`);

  console.log(
    dim("\nOpen Buddy Reading in the app — Join Requests should show Wren.\n"),
  );
}

/** Full sprint: Ivy starts, Wren and Juno join, everyone submits. */
async function cmdScenarioSprint(minutes = 5) {
  console.log(bold(`\nScenario: three-reader sprint\n`));

  const { sprint } = await post("/api/sprint/start", {
    userId: BOTS.ivy.userId,
    displayName: BOTS.ivy.displayName,
    durationMinutes: Number(minutes),
    startPage: 10,
  });
  ok(`Ivy started a ${minutes}m sprint  ${shortId(sprint._id)}`);

  for (const [name, page] of [["wren", 40], ["juno", 120]]) {
    const reader = BOTS[name];
    await post(`/api/sprint/${sprint._id}/join`, {
      userId: reader.userId,
      displayName: reader.displayName,
      startPage: page,
    });
    ok(`${reader.displayName} joined from page ${page}`);
  }

  await post("/api/sprint/messages", {
    senderUserId: BOTS.wren.userId,
    senderDisplayName: BOTS.wren.displayName,
    text: "good luck everyone!",
  });
  ok("Wren said hello in sprint chat");

  console.log(
    dim(`\nJoin from the app, then when the timer ends submit pages:\n`) +
      `  node sim.mjs sprint:submit wren ${sprint._id} 75\n`,
  );
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

const COMMANDS = {
  // buddy
  board: cmdBoard,
  post: cmdPost,
  request: cmdRequest,
  accept: (...a) => cmdRespond(true, ...a),
  decline: (...a) => cmdRespond(false, ...a),
  say: cmdSay,
  progress: cmdProgress,
  leave: cmdLeave,
  mine: cmdMine,
  reopen: cmdReopen,
  // sprints
  sprint: cmdSprint,
  "sprint:start": cmdSprintStart,
  "sprint:join": cmdSprintJoin,
  "sprint:submit": cmdSprintSubmit,
  "sprint:say": cmdSprintSay,
  leaderboard: cmdLeaderboard,
  // scenarios
  "scenario:requests": cmdScenarioRequests,
  "scenario:join-me": cmdScenarioJoinMe,
  "scenario:sprint": cmdScenarioSprint,
};

const HELP = `
${bold("sim.mjs")} — multiplayer test harness for Lumey

${bold("Readers")}   ${Object.entries(BOTS).map(([k, v]) => `${k} (${v.displayName})`).join(", ")}
${bold("API")}       ${API}
${bold("You")}       ${ME}

${bold("Buddy reads")}
  board                              list the announcement board
  post <who> <title...>              a reader posts an announcement
  request <who> <announcementId>     a reader asks to join
  accept <actor> <groupId> <who>     approve a request (actor can be "me")
  decline <actor> <groupId> <who>    decline a request
  say <who> <groupId> <text...>      send a chat message
  progress <who> <groupId> <chapter> post a progress update
  leave <who|me> <groupId>           leave a group
  mine [who|me]                      list groups someone is in
  reopen <announcementId>            admin reopen a closed announcement

${bold("Sprints")}
  sprint                             show the active sprint
  sprint:start <who> [min] [page]    start a sprint
  sprint:join <who> <sprintId> [pg]  join a sprint
  sprint:submit <who> <id> <endPage> submit an end page
  sprint:say <who> <text...>         send sprint chat
  leaderboard                        all-time leaderboard

${bold("Scenarios")}
  scenario:join-me [title...]        you post a read, Wren requests to join it
  scenario:requests                  Ivy posts, Wren and Juno both request
  scenario:sprint [minutes]          Ivy starts a sprint, Wren and Juno join

${bold("Examples")}
  node sim.mjs scenario:join-me "Ruinous Ends"
  node sim.mjs mine
  node sim.mjs say wren 6f2a91 "what did you think of chapter 4?"
  API=http://localhost:3000 node sim.mjs board
`;

const [, , command, ...args] = process.argv;

if (!command || command === "help" || command === "--help") {
  console.log(HELP);
  process.exit(0);
}

const handler = COMMANDS[command];
if (!handler) {
  console.error(`Unknown command "${command}". Run \`node sim.mjs help\`.`);
  process.exit(1);
}

handler(...args).catch((error) => fail(error.message));
