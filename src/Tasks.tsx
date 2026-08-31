import { Errored, For, Loading, Show, createSignal } from "solid-js";
import { ErrorNotice, errorFallback, errorMessage } from "./ErrorFallback";
import { api } from "../convex/_generated/api";
import type { Doc, Id } from "../convex/_generated/dataModel";
import { createConvexQuery, getConvexClient, getConvexUrl } from "./lib/convex";

function TaskRow(props: { task: Doc<"tasks">; onToggle: (id: Id<"tasks">) => void }) {
  return (
    <li class="task-item">
      <button class="increment" type="button" onClick={() => props.onToggle(props.task._id)}>
        {props.task.isCompleted ? "Done" : "Todo"}
      </button>
      <span class={["task-text", { done: props.task.isCompleted }]}>{props.task.text}</span>
    </li>
  );
}

function TaskList(props: { tasks: Doc<"tasks">[]; onToggle: (id: Id<"tasks">) => void }) {
  return (
    <Loading fallback={<p class="status">Connecting to Convex…</p>}>
      <ul class="task-list">
        <For
          each={props.tasks}
          keyed={(task) => task._id}
          fallback={<li class="status">No tasks yet.</li>}
        >
          {(task) => <TaskRow task={task()} onToggle={props.onToggle} />}
        </For>
      </ul>
    </Loading>
  );
}

export default function Tasks() {
  const [text, setText] = createSignal("");
  const [mutationError, setMutationError] = createSignal<string | null>(null);

  if (!getConvexUrl()) {
    return (
      <p class="status">
        Set <code>VITE_CONVEX_URL</code> in <code>.env.local</code> and run{" "}
        <code>bun run convex:dev</code>.
      </p>
    );
  }

  const tasks = createConvexQuery(api.tasks.list, {});

  async function addTask(event: Event) {
    event.preventDefault();
    const convex = getConvexClient();
    const value = text().trim();
    if (!convex || value.length === 0) return;
    setText("");
    setMutationError(null);
    try {
      await convex.mutation(api.tasks.add, { text: value });
    } catch (error) {
      setText(value);
      setMutationError(errorMessage(error));
    }
  }

  async function toggleTask(id: Id<"tasks">) {
    const convex = getConvexClient();
    if (!convex) return;
    setMutationError(null);
    try {
      await convex.mutation(api.tasks.toggle, { id });
    } catch (error) {
      setMutationError(errorMessage(error));
    }
  }

  return (
    <section class="tasks">
      <h2>Convex tasks</h2>
      <form class="task-form" onSubmit={addTask}>
        <input
          value={text()}
          onInput={(event) => setText(event.currentTarget.value)}
          placeholder="New task"
          aria-label="New task"
        />
        <button class="increment" type="submit">
          Add
        </button>
      </form>
      <Show when={mutationError()}>{(message) => <ErrorNotice message={message()} />}</Show>
      <Errored fallback={errorFallback}>
        <TaskList tasks={tasks()} onToggle={toggleTask} />
      </Errored>
    </section>
  );
}
