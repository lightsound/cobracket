import { Errored, For, Loading, createSignal } from 'solid-js';
import ErrorFallback from './ErrorFallback';
import { api } from '../convex/_generated/api';
import type { Doc, Id } from '../convex/_generated/dataModel';
import { createConvexQuery, getConvexClient, getConvexUrl } from './lib/convex';

function TaskRow(props: { task: Doc<'tasks'>; onToggle: (id: Id<'tasks'>) => void }) {
  return (
    <li class="task-item">
      <button
        class="increment"
        type="button"
        onClick={() => props.onToggle(props.task._id)}
      >
        {props.task.isCompleted ? 'Done' : 'Todo'}
      </button>
      <span class={props.task.isCompleted ? 'task-text done' : 'task-text'}>
        {props.task.text}
      </span>
    </li>
  );
}

export default function Tasks() {
  const tasks = createConvexQuery(api.tasks.list, {});
  const [text, setText] = createSignal('');

  if (!getConvexUrl()) {
    return (
      <p class="status">
        Set <code>VITE_CONVEX_URL</code> in <code>.env.local</code> and run{' '}
        <code>bun run convex:dev</code>.
      </p>
    );
  }

  function addTask(event: Event) {
    event.preventDefault();
    const convex = getConvexClient();
    const value = text().trim();
    if (!convex || value.length === 0) return;
    setText('');
    void convex.mutation(api.tasks.add, { text: value });
  }

  function toggleTask(id: Id<'tasks'>) {
    const convex = getConvexClient();
    if (!convex) return;
    void convex.mutation(api.tasks.toggle, { id });
  }

  return (
    <section class="tasks">
      <h2>Convex tasks</h2>
      <Errored fallback={(error, reset) => <ErrorFallback error={error} reset={reset} />}>
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
        <Loading fallback={<p class="status">Connecting to Convex…</p>}>
          <ul class="task-list">
            <For
              each={tasks()}
              keyed={(task) => task._id}
              fallback={<li class="status">No tasks yet.</li>}
            >
              {(task) => <TaskRow task={task()} onToggle={toggleTask} />}
            </For>
          </ul>
        </Loading>
      </Errored>
    </section>
  );
}
