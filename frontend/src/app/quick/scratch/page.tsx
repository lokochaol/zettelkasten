import { redirect } from "next/navigation";

/** The 走り書き quick app's first address. It moved to /quick/dash-off, the
 * same name as the main app's 走り書き page; a link or home-screen icon
 * made before that still lands in the right place. */
export default function OldQuickScratchPage() {
  redirect("/quick/dash-off");
}
