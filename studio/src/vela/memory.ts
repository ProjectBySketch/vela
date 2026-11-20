import { ArcEvent, ArcObject, VelaValue } from './types';

export class ArcMemoryManager {
  private nextId = 1;
  private step = 0;
  public objects = new Map<number, ArcObject>();
  public events: ArcEvent[] = [];

  alloc(label: string, kind: string, bytes: number, line: number, refs: number[] = []): number {
    const id = this.nextId++;
    const obj: ArcObject = {
      id,
      label,
      kind,
      rc: 1,
      bytes,
      freed: false,
      cowCopies: 0,
      refs,
      bornLine: line,
    };
    this.objects.set(id, obj);
    this.record('alloc', obj, `Allocated ${kind} (${bytes} B) at line ${line}`);
    return id;
  }

  retain(id?: number, detail = 'Retained reference') {
    if (!id) return;
    const obj = this.objects.get(id);
    if (!obj || obj.freed) return;
    obj.rc += 1;
    this.record('retain', obj, detail);
  }

  release(id?: number, detail = 'Scope exit release') {
    if (!id) return;
    const obj = this.objects.get(id);
    if (!obj || obj.freed) return;
    obj.rc = Math.max(0, obj.rc - 1);
    this.record('release', obj, detail);
    if (obj.rc === 0) {
      this.dropObj(obj);
    }
  }

  private dropObj(obj: ArcObject) {
    if (obj.freed) return;
    obj.freed = true;
    this.record('drop', obj, `rc reached 0 — freed ${obj.bytes} B (${obj.kind})`);
    for (const childId of obj.refs) {
      this.release(childId, `Cascading release from #${obj.id}`);
    }
  }

  cowSplit(oldId: number | undefined, label: string, kind: string, bytes: number, line: number): number {
    if (oldId) {
      const oldObj = this.objects.get(oldId);
      if (oldObj && !oldObj.freed) {
        if (oldObj.rc <= 1) {
          // Mutate in-place (unique owner optimization!)
          return oldId;
        }
        oldObj.cowCopies += 1;
        this.record('cow_split', oldObj, `CoW split triggered (rc=${oldObj.rc} > 1) — duplicating ${kind}`);
        this.release(oldId, 'CoW detached old reference');
      }
    }
    return this.alloc(label, kind, bytes, line);
  }

  addRefEdge(fromId?: number, toId?: number) {
    if (!fromId || !toId) return;
    const obj = this.objects.get(fromId);
    if (obj && !obj.freed && !obj.refs.includes(toId)) {
      obj.refs.push(toId);
    }
  }

  /**
   * Bacon-Rajan style trial-deletion cycle collector.
   * Identifies strongly-connected reference cycles that have zero external roots
   * and frees them deterministically at the end of a scope/program.
   */
  collectCycles(rootIds: Set<number>): number {
    const live = Array.from(this.objects.values()).filter((o) => !o.freed);
    if (live.length === 0) return 0;

    // Build trial refcounts subtracting internal edges among live non-root candidates
    const trialRc = new Map<number, number>();
    for (const o of live) trialRc.set(o.id, o.rc);

    for (const o of live) {
      if (!rootIds.has(o.id)) {
        for (const targetId of o.refs) {
          if (trialRc.has(targetId)) {
            trialRc.set(targetId, Math.max(0, (trialRc.get(targetId) ?? 0) - 1));
          }
        }
      }
    }

    // Mark reachable from any object with trialRc > 0 or in rootIds
    const reachable = new Set<number>();
    const queue: number[] = [];
    for (const o of live) {
      if (rootIds.has(o.id) || (trialRc.get(o.id) ?? 0) > 0) {
        reachable.add(o.id);
        queue.push(o.id);
      }
    }
    while (queue.length > 0) {
      const cur = queue.shift()!;
      const obj = this.objects.get(cur);
      if (!obj) continue;
      for (const next of obj.refs) {
        if (!reachable.has(next)) {
          reachable.add(next);
          queue.push(next);
        }
      }
    }

    let collected = 0;
    for (const o of live) {
      if (!reachable.has(o.id) && !o.freed) {
        o.freed = true;
        o.rc = 0;
        collected++;
        this.record('cycle_collect', o, `Cycle collector reclaimed unreachable cycle node #${o.id} (${o.bytes} B)`);
      }
    }
    return collected;
  }

  collectValueIds(v: VelaValue, out: Set<number>) {
    if (v.tag === 'list') {
      if (v.arcId) out.add(v.arcId);
      for (const it of v.items) this.collectValueIds(it, out);
    } else if (v.tag === 'map') {
      if (v.arcId) out.add(v.arcId);
      for (const it of v.entries.values()) this.collectValueIds(it, out);
    } else if (v.tag === 'struct') {
      if (v.arcId) out.add(v.arcId);
      for (const it of v.fields.values()) this.collectValueIds(it, out);
    } else if (v.tag === 'str' && v.arcId) {
      out.add(v.arcId);
    } else if (v.tag === 'option' && v.some && v.val) {
      this.collectValueIds(v.val, out);
    } else if (v.tag === 'result') {
      this.collectValueIds(v.val, out);
    }
  }

  private record(op: ArcEvent['op'], obj: ArcObject, detail: string) {
    if (this.events.length < 250) {
      this.events.push({
        step: ++this.step,
        op,
        objId: obj.id,
        label: obj.label,
        rcAfter: obj.rc,
        detail,
      });
    }
  }

  snapshot(): { objects: ArcObject[]; events: ArcEvent[] } {
    return {
      objects: Array.from(this.objects.values()),
      events: this.events,
    };
  }
}
