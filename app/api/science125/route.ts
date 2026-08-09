import { fail, json } from "@/lib/http";
import { readScience125 } from "@/lib/science125";

export const dynamic = "force-dynamic";

export function GET() {
  const data = readScience125();
  if (!data) return fail(500, "fixture_unreadable", "science125 题库解析失败");
  return json(data);
}
