import { For, createSignal } from 'solid-js';
import { api } from '../convex/_generated/api';
import type { Id } from '../convex/_generated/dataModel';
import { createConvexQuery, getConvexClient, getConvexUrl } from './lib/convex';
import logo from './logo.svg';
import './App.css';

function Tasks() {
  const { data, error } = createConvexQuery(api.tasks.list, {});
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
    void convex.mutation(api.tasks.add, { text: value }).then(() => setText(''));
  }

  function toggleTask(id: Id<'tasks'>) {
    const convex = getConvexClient();
    if (!convex) return;
    void convex.mutation(api.tasks.toggle, { id });
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
      {error() ? (
        <p class="status">{error()!.message}</p>
      ) : (
        <ul class="task-list">
          <For
            each={data()}
            fallback={
              <li class="status">
                {data() === undefined ? 'Connecting to Convex…' : 'No tasks yet.'}
              </li>
            }
          >
            {(task) => (
              <li class="task-item">
                <button
                  class="increment"
                  type="button"
                  onClick={() => toggleTask(task._id)}
                >
                  {task.isCompleted ? 'Done' : 'Todo'}
                </button>
                <span class={task.isCompleted ? 'task-text done' : 'task-text'}>
                  {task.text}
                </span>
              </li>
            )}
          </For>
        </ul>
      )}
    </section>
  );
}

export default function App() {
  const [count, setCount] = createSignal(0);

  return (
    <header class="header">
      <img src={logo} class="logo" alt="Solid logo" />
      <p>
        Edit <code>src/App.tsx</code> and save to reload.
      </p>
      <button class="increment" onClick={() => setCount(count() + 1)}>
        Clicks: {count()}
      </button>
      <a
        class="link"
        href="https://v2.solidjs.com/"
        target="_blank"
        rel="noopener noreferrer"
      >
        Learn Solid
      </a>
      <Tasks />
    </header>
  );
}
