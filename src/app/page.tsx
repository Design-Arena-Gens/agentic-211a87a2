'use client';

import type { FormEvent, ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";

type EnergyLevel = "low" | "medium" | "high";

type Task = {
  id: string;
  title: string;
  duration: number;
  priority: number;
  energy: EnergyLevel;
  note?: string;
  createdAt: number;
};

type ScheduleBlockType =
  | "warmup"
  | "task"
  | "break"
  | "lunch"
  | "wrap"
  | "buffer";

type ScheduleBlock = {
  id: string;
  kind: ScheduleBlockType;
  label: string;
  start: number;
  end: number;
  supportingText?: string;
  task?: Task;
  muted?: boolean;
};

type FocusProfile = {
  key: string;
  label: string;
  description: string;
  start: number;
  breakFrequency: number;
  breakLength: number;
  warmup: number;
  wrap: number;
};

const MINUTES_IN_DAY = 24 * 60;
const STORAGE_KEY = "daily-schedule-maker-v1";

const createId = () => {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
};

const focusProfiles: FocusProfile[] = [
  {
    key: "sunrise",
    label: "Sunrise Starter",
    description: "Lean into an early, intentional flow.",
    start: timeToMinutesStatic("06:30"),
    breakFrequency: 80,
    breakLength: 12,
    warmup: 12,
    wrap: 10,
  },
  {
    key: "balanced",
    label: "Balanced Day",
    description: "Classic 8am launch with even pacing.",
    start: timeToMinutesStatic("08:00"),
    breakFrequency: 90,
    breakLength: 10,
    warmup: 10,
    wrap: 12,
  },
  {
    key: "late",
    label: "Night Owl",
    description: "Protect your creative afternoons.",
    start: timeToMinutesStatic("10:00"),
    breakFrequency: 75,
    breakLength: 15,
    warmup: 8,
    wrap: 15,
  },
];

const quickCaptures: Array<Omit<Task, "id" | "createdAt">> = [
  {
    title: "Deep Work Sprint",
    duration: 90,
    priority: 5,
    energy: "high",
    note: "Turn off notifications and dive in.",
  },
  {
    title: "Inbox Zero Sweep",
    duration: 25,
    priority: 2,
    energy: "low",
    note: "Batch-process communications.",
  },
  {
    title: "Strategy Diffusion",
    duration: 45,
    priority: 4,
    energy: "medium",
    note: "Think, outline, and capture next actions.",
  },
];

const energyBadges: Record<
  EnergyLevel,
  { label: string; className: string; blurb: string }
> = {
  high: {
    label: "High focus",
    className:
      "bg-emerald-100 text-emerald-700 border border-emerald-200 dark:bg-emerald-900/30 dark:text-emerald-200 dark:border-emerald-800",
    blurb: "Protect your most impactful work here.",
  },
  medium: {
    label: "Steady",
    className:
      "bg-sky-100 text-sky-700 border border-sky-200 dark:bg-sky-900/30 dark:text-sky-200 dark:border-sky-800",
    blurb: "Great spot for collaborative or strategic work.",
  },
  low: {
    label: "Light lift",
    className:
      "bg-amber-100 text-amber-700 border border-amber-200 dark:bg-amber-900/30 dark:text-amber-200 dark:border-amber-800",
    blurb: "Use these for maintenance and shallow tasks.",
  },
};

function timeToMinutesStatic(value: string) {
  const [hours, minutes] = value.split(":").map(Number);
  const h = Number.isFinite(hours) ? hours : 0;
  const m = Number.isFinite(minutes) ? minutes : 0;
  return clampToDay(h * 60 + m);
}

function clampToDay(value: number) {
  const bounded = Math.max(0, Math.min(value, MINUTES_IN_DAY));
  return bounded;
}

function minutesToTimeString(value: number) {
  const minutes = clampToDay(Math.round(value));
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, "0")}:${String(mins).padStart(2, "0")}`;
}

function formatTimeLabel(minutes: number) {
  const label = minutesToTimeString(minutes);
  const [h, m] = label.split(":").map(Number);
  const suffix = h >= 12 ? "PM" : "AM";
  const normalized = h % 12 === 0 ? 12 : h % 12;
  return `${normalized}:${String(m).padStart(2, "0")} ${suffix}`;
}

function parseTimeInput(value: string) {
  if (!value || !value.includes(":")) {
    return 8 * 60;
  }
  return clampToDay(timeToMinutesStatic(value));
}

function buildSchedule({
  tasks,
  startMinutes,
  breakFrequency,
  breakLength,
  warmup,
  wrap,
  endMinutes,
  autoLunch,
}: {
  tasks: Task[];
  startMinutes: number;
  breakFrequency: number;
  breakLength: number;
  warmup: number;
  wrap: number;
  endMinutes: number | null;
  autoLunch: boolean;
}) {
  const sorted = [...tasks].sort((a, b) => {
    if (a.priority === b.priority) {
      if (a.energy === b.energy) {
        return a.createdAt - b.createdAt;
      }
      const energyScore = energyRank(b.energy) - energyRank(a.energy);
      if (energyScore !== 0) {
        return energyScore;
      }
      return a.createdAt - b.createdAt;
    }
    return b.priority - a.priority;
  });

  const blocks: ScheduleBlock[] = [];
  let cursor = startMinutes;
  let minutesSinceBreak = 0;

  if (warmup > 0) {
    const end = cursor + warmup;
    blocks.push({
      id: createId(),
      kind: "warmup",
      label: "Prime the day",
      start: cursor,
      end,
      supportingText: "Skim your agenda, set intention, and calibrate energy.",
    });
    cursor = end;
    minutesSinceBreak = 0;
  }

  const lunchStart = 12 * 60 + 30;
  const lunchLength = 35;

  for (const task of sorted) {
    if (endMinutes !== null && cursor >= endMinutes) {
      break;
    }

    if (breakFrequency > 0 && minutesSinceBreak >= breakFrequency) {
      const breakEnd = cursor + breakLength;
      if (!endMinutes || breakEnd <= endMinutes) {
        blocks.push({
          id: createId(),
          kind: "break",
          label: "Reset break",
          start: cursor,
          end: breakEnd,
          supportingText: "Hydrate, stretch, breathe.",
        });
        cursor = breakEnd;
        minutesSinceBreak = 0;
      }
    }

    if (
      autoLunch &&
      cursor < lunchStart &&
      cursor + task.duration > lunchStart
    ) {
      const lunchEnd = lunchStart + lunchLength;
      if (!endMinutes || lunchEnd <= endMinutes) {
        blocks.push({
          id: createId(),
          kind: "lunch",
          label: "Lunch reset",
          start: lunchStart,
          end: lunchEnd,
          supportingText: "Step away, refuel, protect the pause.",
        });
      }
      cursor = lunchEnd;
      minutesSinceBreak = 0;
    }

    const plannedEnd = cursor + task.duration;
    let actualEnd = plannedEnd;
    let muted = false;
    if (endMinutes !== null && plannedEnd > endMinutes) {
      actualEnd = endMinutes;
      muted = true;
    }
    if (actualEnd <= cursor) {
      continue;
    }

    blocks.push({
      id: task.id,
      kind: "task",
      label: task.title,
      start: cursor,
      end: actualEnd,
      supportingText: task.note,
      task,
      muted,
    });

    minutesSinceBreak += task.duration;
    cursor = actualEnd;
  }

  if (wrap > 0 && (!endMinutes || cursor + wrap <= endMinutes)) {
    blocks.push({
      id: createId(),
      kind: "wrap",
      label: "Wind-down",
      start: cursor,
      end: cursor + wrap,
      supportingText: "Capture wins, park tomorrow’s top 3, close loops.",
    });
    cursor += wrap;
  }

  const finish = cursor;

  return {
    blocks,
    finish,
  };
}

function energyRank(level: EnergyLevel) {
  switch (level) {
    case "high":
      return 3;
    case "medium":
      return 2;
    default:
      return 1;
  }
}

const defaultTasksSeed: Array<Omit<Task, "id">> = [
  {
    title: "Clarity checkpoint",
    duration: 15,
    priority: 3,
    energy: "low",
    note: "Review inbox, surface blockers.",
    createdAt: Date.now(),
  },
  {
    title: "Signature project push",
    duration: 90,
    priority: 5,
    energy: "high",
    note: "Ship the work that moves the week forward.",
    createdAt: Date.now() + 1,
  },
  {
    title: "Team sync / touchpoints",
    duration: 45,
    priority: 4,
    energy: "medium",
    note: "Align, unblock, and document actions.",
    createdAt: Date.now() + 2,
  },
];

const seedTasks = (): Task[] =>
  defaultTasksSeed.map((task) => ({
    ...task,
    id: createId(),
  }));

type PersistedState = {
  name: string;
  tasks: Task[];
  startTime: string;
  endTime: string;
  profile: string;
  breakFrequency: number;
  breakLength: number;
  autoLunch: boolean;
  includeWarmup: boolean;
  includeWrap: boolean;
};

export default function Home() {
  const [name, setName] = useState("You");
  const [profile, setProfile] = useState<FocusProfile["key"]>("balanced");
  const [profileVersion, setProfileVersion] = useState(0);
  const [startTime, setStartTime] = useState("08:00");
  const [endTime, setEndTime] = useState("17:30");
  const [breakFrequency, setBreakFrequency] = useState(90);
  const [breakLength, setBreakLength] = useState(10);
  const [includeWarmup, setIncludeWarmup] = useState(true);
  const [includeWrap, setIncludeWrap] = useState(true);
  const [autoLunch, setAutoLunch] = useState(true);
  const [tasks, setTasks] = useState<Task[]>(() => seedTasks());
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        const parsed = JSON.parse(saved) as PersistedState;
        if (parsed.tasks?.length) {
          setTasks(
            parsed.tasks.map((task) => ({
              ...task,
              id: task.id ?? createId(),
            }))
          );
        }
        if (parsed.name) {
          setName(parsed.name);
        }
        if (parsed.profile) {
          setProfile(parsed.profile as FocusProfile["key"]);
        }
        if (parsed.startTime) {
          setStartTime(parsed.startTime);
        }
        if (parsed.endTime) {
          setEndTime(parsed.endTime);
        }
        if (typeof parsed.breakFrequency === "number") {
          setBreakFrequency(parsed.breakFrequency);
        }
        if (typeof parsed.breakLength === "number") {
          setBreakLength(parsed.breakLength);
        }
        if (typeof parsed.autoLunch === "boolean") {
          setAutoLunch(parsed.autoLunch);
        }
        if (typeof parsed.includeWarmup === "boolean") {
          setIncludeWarmup(parsed.includeWarmup);
        }
        if (typeof parsed.includeWrap === "boolean") {
          setIncludeWrap(parsed.includeWrap);
        }
      }
    } catch {
      // If parsing fails, fall back silently.
    } finally {
      setReady(true);
    }
  }, []);

  useEffect(() => {
    if (!ready || profileVersion === 0) {
      return;
    }
    const profilePreset = focusProfiles.find((item) => item.key === profile);
    if (profilePreset) {
      setStartTime(minutesToTimeString(profilePreset.start));
      setBreakFrequency(profilePreset.breakFrequency);
      setBreakLength(profilePreset.breakLength);
      setIncludeWarmup(profilePreset.warmup > 0);
      setIncludeWrap(profilePreset.wrap > 0);
    }
  }, [profile, profileVersion, ready]);

  useEffect(() => {
    if (!ready) {
      return;
    }
    const state: PersistedState = {
      name,
      tasks,
      startTime,
      endTime,
      profile,
      breakFrequency,
      breakLength,
      autoLunch,
      includeWarmup,
      includeWrap,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [
    autoLunch,
    breakFrequency,
    breakLength,
    endTime,
    includeWarmup,
    includeWrap,
    name,
    profile,
    ready,
    startTime,
    tasks,
  ]);

  const [draftTitle, setDraftTitle] = useState("");
  const [draftDuration, setDraftDuration] = useState(45);
  const [draftPriority, setDraftPriority] = useState(3);
  const [draftEnergy, setDraftEnergy] = useState<EnergyLevel>("medium");
  const [draftNote, setDraftNote] = useState("");

  const startMinutes = parseTimeInput(startTime);
  const endMinutes = endTime ? parseTimeInput(endTime) : null;

  const warmupLength = includeWarmup
    ? focusProfiles.find((item) => item.key === profile)?.warmup ?? 10
    : 0;

  const wrapLength = includeWrap
    ? focusProfiles.find((item) => item.key === profile)?.wrap ?? 10
    : 0;

  const schedule = useMemo(
    () =>
      buildSchedule({
        tasks,
        startMinutes,
        breakFrequency,
        breakLength,
        warmup: warmupLength,
        wrap: wrapLength,
        endMinutes,
        autoLunch,
      }),
    [
      autoLunch,
      breakFrequency,
      breakLength,
      endMinutes,
      startMinutes,
      tasks,
      warmupLength,
      wrapLength,
    ]
  );

  const totalFocusMinutes = schedule.blocks
    .filter((block) => block.kind === "task")
    .reduce((acc, block) => acc + (block.end - block.start), 0);

  const energySpread = schedule.blocks
    .filter((block) => block.kind === "task" && block.task)
    .reduce<Record<EnergyLevel, number>>(
      (acc, block) => {
        if (!block.task) {
          return acc;
        }
        acc[block.task.energy] += block.end - block.start;
        return acc;
      },
      {
        high: 0,
        medium: 0,
        low: 0,
      }
    );

  const focusProfile = focusProfiles.find((item) => item.key === profile);
  const handleProfileChange = (value: FocusProfile["key"]) => {
    setProfile(value);
    setProfileVersion((prev) => prev + 1);
  };

  const addTaskFromDraft = () => {
    if (!draftTitle.trim()) {
      return;
    }
    const sanitizedDuration = Math.max(5, Math.min(240, draftDuration));
    const sanitizedPriority = Math.max(1, Math.min(5, draftPriority));
    const newTask: Task = {
      id: createId(),
      title: draftTitle.trim(),
      duration: sanitizedDuration,
      priority: sanitizedPriority,
      energy: draftEnergy,
      note: draftNote.trim() || undefined,
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, newTask]);
    setDraftTitle("");
    setDraftDuration(45);
    setDraftPriority(3);
    setDraftEnergy("medium");
    setDraftNote("");
  };

  const handleDeleteTask = (id: string) => {
    setTasks((prev) => prev.filter((task) => task.id !== id));
  };

  const handleDuplicateTask = (task: Task) => {
    const clone: Task = {
      ...task,
      id: createId(),
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, clone]);
  };

  const handleQuickCapture = (template: Omit<Task, "id" | "createdAt">) => {
    const entry: Task = {
      ...template,
      id: createId(),
      createdAt: Date.now(),
    };
    setTasks((prev) => [...prev, entry]);
  };

  const dayFinish = schedule.finish;
  const finishLabel = formatTimeLabel(dayFinish);

  return (
    <div className="bg-gradient-to-br from-zinc-50 via-white to-zinc-200 dark:from-zinc-950 dark:via-zinc-900 dark:to-zinc-900 min-h-screen py-10">
      <div className="mx-auto flex max-w-6xl flex-col gap-8 px-4 pb-16 sm:px-8">
        <header className="rounded-3xl bg-white/70 p-6 shadow-lg shadow-zinc-800/5 backdrop-blur dark:bg-zinc-900/80 dark:shadow-black/20 sm:p-10">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <p className="text-sm uppercase tracking-[0.3em] text-zinc-400">
                Daily Flow Architect
              </p>
              <h1 className="mt-2 text-3xl font-semibold text-zinc-900 dark:text-zinc-50 sm:text-4xl">
                {name ? `${name}, map your ideal day.` : "Map your ideal day."}
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-6 text-zinc-600 dark:text-zinc-300">
                Curate tasks, pace your focus, and let the schedule builder
                carve a day that feels intentional. Tweak profiles, inject
                rituals, and carry over unfinished work tomorrow with clarity.
              </p>
            </div>
            <div className="rounded-2xl border border-zinc-200 bg-white p-4 text-sm text-zinc-600 shadow-sm dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-200">
              <p className="text-xs font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                Flow Snapshot
              </p>
              <dl className="mt-3 space-y-2">
                <div className="flex items-center justify-between gap-6">
                  <dt className="text-xs text-zinc-500">Focus Minutes</dt>
                  <dd className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {totalFocusMinutes}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <dt className="text-xs text-zinc-500">Tasks Captured</dt>
                  <dd className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {tasks.length}
                  </dd>
                </div>
                <div className="flex items-center justify-between gap-6">
                  <dt className="text-xs text-zinc-500">Target Finish</dt>
                  <dd className="font-semibold text-zinc-900 dark:text-zinc-50">
                    {finishLabel}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </header>

        <div className="grid grid-cols-1 gap-8 lg:grid-cols-[360px_1fr]">
          <section className="space-y-8">
            <ProfilePanel
              name={name}
              onNameChange={setName}
              profile={profile}
              onProfileChange={handleProfileChange}
              startTime={startTime}
              onStartTimeChange={setStartTime}
              endTime={endTime}
              onEndTimeChange={setEndTime}
              breakFrequency={breakFrequency}
              onBreakFrequencyChange={setBreakFrequency}
              breakLength={breakLength}
              onBreakLengthChange={setBreakLength}
              autoLunch={autoLunch}
              onAutoLunchChange={setAutoLunch}
              includeWarmup={includeWarmup}
              onIncludeWarmupChange={setIncludeWarmup}
              includeWrap={includeWrap}
              onIncludeWrapChange={setIncludeWrap}
              focusProfile={focusProfile}
            />

            <QuickCapturePanel
              templates={quickCaptures}
              onQuickCapture={handleQuickCapture}
            />

            <TaskComposer
              title={draftTitle}
              onTitleChange={setDraftTitle}
              duration={draftDuration}
              onDurationChange={setDraftDuration}
              priority={draftPriority}
              onPriorityChange={setDraftPriority}
              energy={draftEnergy}
              onEnergyChange={setDraftEnergy}
              note={draftNote}
              onNoteChange={setDraftNote}
              onAddTask={addTaskFromDraft}
            />
          </section>

          <section className="space-y-6">
            <TaskList
              tasks={tasks}
              onDeleteTask={handleDeleteTask}
              onDuplicateTask={handleDuplicateTask}
            />
            <SchedulePreview
              schedule={schedule.blocks}
              energySpread={energySpread}
              startMinutes={startMinutes}
              finishMinutes={dayFinish}
            />
          </section>
        </div>
      </div>
    </div>
  );
}

function ProfilePanel({
  name,
  onNameChange,
  profile,
  onProfileChange,
  startTime,
  onStartTimeChange,
  endTime,
  onEndTimeChange,
  breakFrequency,
  onBreakFrequencyChange,
  breakLength,
  onBreakLengthChange,
  autoLunch,
  onAutoLunchChange,
  includeWarmup,
  onIncludeWarmupChange,
  includeWrap,
  onIncludeWrapChange,
  focusProfile,
}: {
  name: string;
  onNameChange: (value: string) => void;
  profile: FocusProfile["key"];
  onProfileChange: (value: FocusProfile["key"]) => void;
  startTime: string;
  onStartTimeChange: (value: string) => void;
  endTime: string;
  onEndTimeChange: (value: string) => void;
  breakFrequency: number;
  onBreakFrequencyChange: (value: number) => void;
  breakLength: number;
  onBreakLengthChange: (value: number) => void;
  autoLunch: boolean;
  onAutoLunchChange: (value: boolean) => void;
  includeWarmup: boolean;
  onIncludeWarmupChange: (value: boolean) => void;
  includeWrap: boolean;
  onIncludeWrapChange: (value: boolean) => void;
  focusProfile?: FocusProfile;
}) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm backdrop-blur dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Personalize the rhythm
          </h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Tailor your anchors, then let the builder pace your day.
          </p>
        </div>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            What should we call you?
          </span>
          <input
            type="text"
            value={name}
            onChange={(event) => onNameChange(event.target.value)}
            placeholder="Your name"
            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-sky-500 dark:focus:ring-sky-800/50"
          />
        </label>

        <div className="space-y-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Focus profile
          </span>
          <div className="grid gap-2">
            {focusProfiles.map((item) => {
              const selected = item.key === profile;
              return (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => onProfileChange(item.key)}
                  className={`flex flex-col rounded-2xl border p-3 text-left transition ${
                    selected
                      ? "border-sky-400 bg-sky-50 shadow-sm dark:border-sky-500/70 dark:bg-sky-500/10"
                      : "border-zinc-200 bg-white hover:border-sky-200 dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-sky-700/50"
                  }`}
                >
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {item.label}
                  </span>
                  <span className="text-xs text-zinc-500 dark:text-zinc-400">
                    {item.description}
                  </span>
                  <div className="mt-2 flex items-center gap-3">
                    <Badge>Start {formatTimeLabel(item.start)}</Badge>
                    <Badge>{item.breakFrequency}m focus cadence</Badge>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field
            label="Launch time"
            description="The day kicks off here."
            input={
              <input
                type="time"
                value={startTime}
                onChange={(event) => onStartTimeChange(event.target.value)}
                className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-sky-500 dark:focus:ring-sky-800/50"
              />
            }
          />
          <Field
            label="Soft stop"
            description="We schedule up to this time."
            input={
              <input
                type="time"
                value={endTime}
                onChange={(event) => onEndTimeChange(event.target.value)}
                className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-sky-500 dark:focus:ring-sky-800/50"
              />
            }
          />
          <Field
            label="Focus cadence"
            description="Minutes of focus before a break."
            input={
              <input
                type="number"
                min={30}
                max={180}
                step={5}
                value={breakFrequency}
                onChange={(event) =>
                  onBreakFrequencyChange(Number(event.target.value) || 0)
                }
                className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-sky-500 dark:focus:ring-sky-800/50"
              />
            }
          />
          <Field
            label="Break length"
            description="Minutes allocated to reset."
            input={
              <input
                type="number"
                min={5}
                max={30}
                step={1}
                value={breakLength}
                onChange={(event) =>
                  onBreakLengthChange(Number(event.target.value) || 0)
                }
                className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-sky-400 focus:outline-none focus:ring-2 focus:ring-sky-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-sky-500 dark:focus:ring-sky-800/50"
              />
            }
          />
        </div>

        <div className="rounded-2xl border border-dashed border-zinc-200 bg-zinc-50/70 p-4 dark:border-zinc-800 dark:bg-zinc-950/60">
          <ToggleRow
            label="Inject a gentle warm-up"
            description="Give your brain a runway before first deep work."
            checked={includeWarmup}
            onChange={onIncludeWarmupChange}
          />
          <ToggleRow
            label="Protect a wrap-up ritual"
            description="Reflect, close loops, and park tomorrow’s priorities."
            checked={includeWrap}
            onChange={onIncludeWrapChange}
          />
          <ToggleRow
            label="Auto-capture a lunch reset"
            description="Algorithm slots a 35m lunch around midday when needed."
            checked={autoLunch}
            onChange={onAutoLunchChange}
          />
        </div>

        {focusProfile && (
          <div className="rounded-2xl border border-sky-200 bg-sky-50/70 p-4 text-xs text-sky-700 dark:border-sky-700/50 dark:bg-sky-900/20 dark:text-sky-200">
            <p className="font-semibold uppercase tracking-wide">
              Pulse for {focusProfile.label}
            </p>
            <ul className="mt-2 space-y-1">
              <li>
                Launch at <strong>{formatTimeLabel(focusProfile.start)}</strong>
              </li>
              <li>
                Cycle focus every{" "}
                <strong>{focusProfile.breakFrequency} minutes</strong>
              </li>
              <li>
                Reset for <strong>{focusProfile.breakLength} minutes</strong>{" "}
                between blocks.
              </li>
            </ul>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickCapturePanel({
  templates,
  onQuickCapture,
}: {
  templates: Array<Omit<Task, "id" | "createdAt">>;
  onQuickCapture: (template: Omit<Task, "id" | "createdAt">) => void;
}) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white/75 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex items-center justify-between">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
            Quick capture
          </h3>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
            Drop in proven anchors with one tap.
          </p>
        </div>
      </div>
      <div className="mt-4 grid gap-3">
        {templates.map((template) => (
          <button
            key={template.title}
            type="button"
            onClick={() => onQuickCapture(template)}
            className="flex items-start justify-between rounded-2xl border border-zinc-200 bg-white px-4 py-3 text-left transition hover:border-sky-300 hover:shadow-sm dark:border-zinc-700 dark:bg-zinc-950 dark:hover:border-sky-700/60"
          >
            <div>
              <p className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                {template.title}
              </p>
              {template.note && (
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  {template.note}
                </p>
              )}
            </div>
            <div className="flex flex-col items-end gap-1">
              <Badge>{template.duration}m</Badge>
              <Badge>Priority {template.priority}</Badge>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TaskComposer({
  title,
  onTitleChange,
  duration,
  onDurationChange,
  priority,
  onPriorityChange,
  energy,
  onEnergyChange,
  note,
  onNoteChange,
  onAddTask,
}: {
  title: string;
  onTitleChange: (value: string) => void;
  duration: number;
  onDurationChange: (value: number) => void;
  priority: number;
  onPriorityChange: (value: number) => void;
  energy: EnergyLevel;
  onEnergyChange: (value: EnergyLevel) => void;
  note: string;
  onNoteChange: (value: string) => void;
  onAddTask: () => void;
}) {
  const handleSubmit = (event: FormEvent) => {
    event.preventDefault();
    onAddTask();
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70"
    >
      <h3 className="text-sm font-semibold uppercase tracking-wide text-zinc-500">
        Craft a task
      </h3>
      <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
        Name the block, give it weight, capture context.
      </p>

      <div className="mt-4 flex flex-col gap-4">
        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Title
          </span>
          <input
            type="text"
            required
            value={title}
            onChange={(event) => onTitleChange(event.target.value)}
            placeholder="Design review, strategy doc, etc."
            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-emerald-500 dark:focus:ring-emerald-800/50"
          />
        </label>

        <div className="grid grid-cols-3 gap-3">
          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Duration (min)
            </span>
            <input
              type="number"
              min={5}
              max={240}
              step={5}
              value={duration}
              onChange={(event) => onDurationChange(Number(event.target.value))}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-emerald-500 dark:focus:ring-emerald-800/50"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Priority
            </span>
            <input
              type="number"
              min={1}
              max={5}
              value={priority}
              onChange={(event) => onPriorityChange(Number(event.target.value))}
              className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-emerald-500 dark:focus:ring-emerald-800/50"
            />
          </label>

          <label className="space-y-1">
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Energy
            </span>
            <select
              value={energy}
              onChange={(event) =>
                onEnergyChange(event.target.value as EnergyLevel)
              }
              className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-emerald-500 dark:focus:ring-emerald-800/50"
            >
              <option value="high">High focus</option>
              <option value="medium">Steady</option>
              <option value="low">Light lift</option>
            </select>
          </label>
        </div>

        <label className="space-y-1">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Context / notes
          </span>
          <textarea
            value={note}
            onChange={(event) => onNoteChange(event.target.value)}
            rows={3}
            placeholder="What does success look like for this block?"
            className="w-full rounded-2xl border border-zinc-200 bg-white px-3 py-2 text-sm shadow-inner focus:border-emerald-400 focus:outline-none focus:ring-2 focus:ring-emerald-100 dark:border-zinc-700 dark:bg-zinc-950 dark:text-zinc-50 dark:shadow-none dark:focus:border-emerald-500 dark:focus:ring-emerald-800/50"
          />
        </label>

        <button
          type="submit"
          className="inline-flex items-center justify-center rounded-2xl bg-emerald-600 px-4 py-2 text-sm font-semibold text-white shadow transition hover:bg-emerald-500 focus:outline-none focus:ring-2 focus:ring-emerald-200 dark:bg-emerald-500 dark:hover:bg-emerald-400 dark:focus:ring-emerald-700/30"
        >
          Add to schedule
        </button>
      </div>
    </form>
  );
}

function TaskList({
  tasks,
  onDeleteTask,
  onDuplicateTask,
}: {
  tasks: Task[];
  onDeleteTask: (id: string) => void;
  onDuplicateTask: (task: Task) => void;
}) {
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white/80 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/70">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Task stack
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Priorities sort automatically. Duplicate or remove as you like.
          </p>
        </div>
        <Badge>{tasks.length} captured</Badge>
      </div>

      {tasks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/50 dark:text-zinc-400">
          No tasks yet. Use quick capture or craft one to start shaping the day.
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {tasks.map((task) => (
            <li
              key={task.id}
              className="rounded-2xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:border-emerald-200 dark:border-zinc-800 dark:bg-zinc-950/80 dark:hover:border-emerald-700/60"
            >
              <div className="flex flex-wrap items-start justify-between gap-4">
                <div>
                  <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-50">
                    {task.title}
                  </h3>
                  {task.note && (
                    <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">
                      {task.note}
                    </p>
                  )}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge>Priority {task.priority}</Badge>
                  <Badge>{task.duration}m</Badge>
                  <span
                    className={`rounded-full px-2.5 py-1 text-xs font-semibold ${energyBadges[task.energy].className}`}
                  >
                    {energyBadges[task.energy].label}
                  </span>
                </div>
              </div>
              <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-xs text-zinc-500 dark:text-zinc-400">
                <p>{energyBadges[task.energy].blurb}</p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => onDuplicateTask(task)}
                    className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 transition hover:border-emerald-200 hover:text-emerald-600 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-emerald-600/60 dark:hover:text-emerald-300"
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    onClick={() => onDeleteTask(task.id)}
                    className="rounded-full border border-zinc-300 px-3 py-1 font-medium text-zinc-700 transition hover:border-red-200 hover:text-red-500 dark:border-zinc-700 dark:text-zinc-300 dark:hover:border-red-500/60 dark:hover:text-red-300"
                  >
                    Remove
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SchedulePreview({
  schedule,
  energySpread,
  startMinutes,
  finishMinutes,
}: {
  schedule: ScheduleBlock[];
  energySpread: Record<EnergyLevel, number>;
  startMinutes: number;
  finishMinutes: number;
}) {
  const focusMinutes = Object.values(energySpread).reduce(
    (total, minutes) => total + minutes,
    0
  );
  return (
    <div className="rounded-3xl border border-zinc-200 bg-white/90 p-6 shadow-sm dark:border-zinc-800 dark:bg-zinc-900/80">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
            Crafted timeline
          </h2>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Drag and drop mentally—this view stays pristine and export-ready.
          </p>
        </div>
        <div className="flex gap-2">
          <Badge>Start {formatTimeLabel(startMinutes)}</Badge>
          <Badge>Finish {formatTimeLabel(finishMinutes)}</Badge>
        </div>
      </div>

      <div className="mt-6 grid gap-4">
        {schedule.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-zinc-300 bg-zinc-50/60 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/40 dark:text-zinc-400">
            Add tasks and we’ll orchestrate a timeline automatically.
          </div>
        ) : (
          schedule.map((block) => (
            <div
              key={block.id}
              className={`flex flex-col gap-3 rounded-2xl border px-4 py-3 shadow-sm transition ${
                block.kind === "task"
                  ? "border-emerald-100 bg-emerald-50/70 hover:border-emerald-200 hover:bg-emerald-50 dark:border-emerald-800/70 dark:bg-emerald-900/20 dark:hover:border-emerald-600/70"
                  : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-700 dark:bg-zinc-950/70"
              } ${block.muted ? "opacity-70" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                    {formatTimeLabel(block.start)} –{" "}
                    {formatTimeLabel(block.end)}
                  </span>
                  <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">
                    {block.label}
                  </span>
                </div>
                <Badge>
                  {block.kind === "task" ? "Focus" : "Support"} ·{" "}
                  {block.end - block.start}m
                </Badge>
              </div>
              {block.supportingText && (
                <p className="text-sm text-zinc-600 dark:text-zinc-300">
                  {block.supportingText}
                </p>
              )}
              {block.task && (
                <div className="flex flex-wrap gap-2 text-xs">
                  <Badge>Priority {block.task.priority}</Badge>
                  <span
                    className={`rounded-full px-2 py-0.5 font-semibold ${energyBadges[block.task.energy].className}`}
                  >
                    {energyBadges[block.task.energy].label}
                  </span>
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {schedule.length > 0 && (
        <div className="mt-6 rounded-2xl border border-zinc-200 bg-zinc-50/70 p-4 text-sm text-zinc-600 dark:border-zinc-700 dark:bg-zinc-950/60 dark:text-zinc-300">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
            Energy allocation
          </h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            {(["high", "medium", "low"] as const).map((level) => {
              const minutes = energySpread[level];
              return (
                <div
                  key={level}
                  className="rounded-xl border border-zinc-200 bg-white px-3 py-2 text-xs shadow-sm dark:border-zinc-700 dark:bg-zinc-900/80"
                >
                  <p className="font-semibold text-zinc-700 dark:text-zinc-200">
                    {energyBadges[level].label}
                  </p>
                  <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-50">
                    {minutes}m
                  </p>
                  <p className="text-[10px] uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {focusMinutes > 0
                      ? `${Math.round((minutes / focusMinutes) * 100)}%`
                      : "—"}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

function Field({
  label,
  description,
  input,
}: {
  label: string;
  description?: string;
  input: ReactNode;
}) {
  return (
    <label className="space-y-1.5">
      <span className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      {description && (
        <p className="text-xs text-zinc-400 dark:text-zinc-500">{description}</p>
      )}
      {input}
    </label>
  );
}

function ToggleRow({
  label,
  description,
  checked,
  onChange,
}: {
  label: string;
  description: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  return (
    <label className="flex items-start justify-between gap-3 rounded-2xl px-3 py-2 transition hover:bg-white/60 dark:hover:bg-white/5">
      <span>
        <span className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">
          {label}
        </span>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">{description}</p>
      </span>
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-1 h-5 w-5 rounded border border-zinc-300 accent-emerald-500 dark:border-zinc-600"
      />
    </label>
  );
}

function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-zinc-200 bg-white px-2.5 py-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500 dark:border-zinc-700 dark:bg-zinc-950/70 dark:text-zinc-300">
      {children}
    </span>
  );
}
