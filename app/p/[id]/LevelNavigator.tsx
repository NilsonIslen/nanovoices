"use client";

import { useRouter } from "next/navigation";
import { type FormEvent, useState } from "react";

type LevelLink = {
  level: number;
  href: string;
};

export function LevelNavigator({
  currentLevel,
  levels,
}: {
  currentLevel: number;
  levels: LevelLink[];
}) {
  const router = useRouter();
  const [targetLevel, setTargetLevel] = useState(Math.max(currentLevel - 1, 1));

  function navigate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const target = levels.find((level) => level.level === targetLevel);

    if (target) {
      router.push(target.href);
    }
  }

  return (
    <form className="flex flex-wrap items-end gap-2" onSubmit={navigate}>
      <label className="grid gap-1 text-sm font-semibold text-[var(--nano-deep)]">
        Regresar al nivel:
        <input
          className="focus-ring h-10 w-24 rounded border border-slate-300 bg-white px-3 text-sm"
          min={1}
          max={currentLevel}
          type="number"
          value={targetLevel}
          onChange={(event) => setTargetLevel(Number(event.target.value))}
        />
      </label>
      <button
        className="focus-ring h-10 rounded border border-[var(--nano-blue)] bg-white px-3 text-sm font-semibold text-[var(--nano-blue)]"
        type="submit"
      >
        Ir
      </button>
    </form>
  );
}
