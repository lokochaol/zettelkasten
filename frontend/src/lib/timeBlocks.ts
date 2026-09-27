import { prisma } from "@/lib/db";
import { ValidationError } from "@/lib/errors";
import type { TimeBlock } from "@/generated/prisma/client";

export type { TimeBlock };

/**
 * Time the owner set aside for something themselves.
 *
 * The day already shows three things it doesn't own: Google Calendar's
 * events, the week's meals, and the tasks written in the project notes.
 * None of those says when a task will actually happen. This is the one
 * part of the day the owner puts there by hand — so it stays here rather
 * than in Google Calendar, which may not be linked, and rather than in
 * the note, which is a document and not a schedule.
 */

/** Long enough to be worth drawing, short of a whole day. */
const MIN_MINUTES = 5;
const MAX_MINUTES = 24 * 60;

export interface TimeBlockInput {
  dateKey: string;
  startMinutes: number;
  durationMinutes: number;
  title: string;
}

export async function add(ownerSub: string, input: TimeBlockInput): Promise<TimeBlock> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.dateKey)) {
    throw new ValidationError("timeBlockInvalid", "date must be YYYY-MM-DD");
  }
  if (!Number.isInteger(input.startMinutes) || input.startMinutes < 0 || input.startMinutes > 1439) {
    throw new ValidationError("timeBlockInvalid", "start must be a time of day");
  }
  if (!Number.isInteger(input.durationMinutes) || input.durationMinutes < MIN_MINUTES || input.durationMinutes > MAX_MINUTES) {
    throw new ValidationError("timeBlockInvalid", "duration is out of range");
  }
  const title = input.title.trim();
  if (!title) throw new ValidationError("timeBlockInvalid", "title is required");
  return prisma.timeBlock.create({
    data: { ownerSub, dateKey: input.dateKey, startMinutes: input.startMinutes, durationMinutes: input.durationMinutes, title },
  });
}

export async function remove(ownerSub: string, id: string): Promise<void> {
  const { count } = await prisma.timeBlock.deleteMany({ where: { id, ownerSub } });
  if (count === 0) throw new ValidationError("timeBlockNotFound", "Time block not found");
}

export async function listForDay(ownerSub: string, dateKey: string): Promise<TimeBlock[]> {
  return prisma.timeBlock.findMany({ where: { ownerSub, dateKey }, orderBy: { startMinutes: "asc" } });
}
