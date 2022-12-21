import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v.1.13.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v.1.13.0/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.2/file.ts";

import { relative } from "https://deno.land/std@0.167.0/path/mod.ts";
import { assert } from "https://deno.land/std@0.167.0/testing/asserts.ts";
import { assertEquals } from "https://deno.land/std@0.166.0/testing/asserts.ts";

type Params = {
  method: string;
  max_wait_ms?: number;
  wait_onetime_ms?: number;
  bufnr?: number;
  highlight_path?: string;
  highlight_place?: string;
};

type Info = {
  lnum: number;
  col: number;
  filename: string;
  text: string;
};
type Method =
  | "references"
  | "implementation"
  | "typeDefinition"
  | "declaration"
  | "definition";

export class Source extends BaseSource<Params> {
  /** To set the counter to prevent mistakes. */
  private counter = 0;

  /** The kind of ddu.*/
  kind = "file";

  gather(
    args: {
      denops: Denops;
      sourceOptions: SourceOptions;
      sourceParams: Params;
      input: string;
    },
  ): ReadableStream<Item<ActionData>[]> {
    this.counter = (this.counter + 1) % 100;
    const id = this.counter;
    return new ReadableStream({
      async start(controller) {
        const method = check_method(args.sourceParams.method);
        const gather_info = async () => {
          const items: Item<ActionData>[] = [];
          try {
            const wait_max_ms = args.sourceParams.max_wait_ms || 1000;
            const wait_onetime_ms = args.sourceParams.wait_onetime_ms || 10;
            const highlight_path = args.sourceParams.highlight_path || "Normal";
            const highlight_place = args.sourceParams.highlight_place ||
              "Normal";

            let res = null;
            assert(wait_max_ms > wait_onetime_ms);
            for (let i = 0; i < wait_max_ms; i += wait_onetime_ms) {
              await new Promise((resolve) =>
                setTimeout(resolve, wait_onetime_ms)
              );
              res = await args.denops.call(
                "ddu_source_vim_lsp#get_cached",
                id,
              ) as Info[] | null;
              if (res !== null) {
                break;
              }
            }
            if (res === null) {
              return [];
            }
            const cwd = await fn.getcwd(args.denops) as string;
            const git_root = await get_git_root(cwd);
            for (const info of res) {
              items.push(
                get_item_from_info(
                  info,
                  cwd,
                  highlight_path,
                  highlight_place,
                  git_root,
                ),
              );
            }
          } catch (e: unknown) {
            console.error(e);
          }
          return items;
        };

        const ddu_bufnr = await args.denops.call("bufnr");
        if (args.sourceParams.bufnr !== undefined) {
          await args.denops.eval(
            `win_gotoid(bufwinid(${args.sourceParams.bufnr}))`,
          );
        }
        const ret = args.denops.call(
          "ddu_source_vim_lsp#get_list",
          method,
          id,
        ) as Promise<boolean>;
        // The get_list is not succeeded because of no LSP server.
        if (await ret) {
          if (args.sourceParams.bufnr !== undefined) {
            await args.denops.eval(`win_gotoid(bufwinid(${ddu_bufnr}))`);
          }

          /** register functions to contoroller.*/
          controller.enqueue(
            await gather_info(),
          );
        } else {
          console.log("[ddu-source-vim-lsp] No candidate are found");
        }
        controller.close();
      },
    });
  }

  params(): Params {
    return {
      method: "references",
      max_wait_ms: 1000,
      wait_onetime_ms: 200,
      bufnr: undefined,
    };
  }
}
function check_method(method_str: string): Method {
  assert(
    (typeof method_str) == "string",
    `You should specify the param method as string, but ${typeof method_str}`,
  );
  method_str = method_str.toLowerCase() as string;
  assert(
    [
      "references",
      "implementation",
      "typeDefinition",
      "declaration",
      "definition",
    ].includes(method_str),
    `The method_str is not valid. The value is '${method_str}'.`,
  );
  return <Method> method_str;
}
function conv_text(text: string): string {
  let j = 0 as number;
  for (let i = 0; i < text.length; i++) {
    if (text[i] != " ") {
      break;
    }
    j = i;
  }
  if (2 < j) {
    j -= 1;
  }
  return text.slice(j, text.length);
}
function get_item_from_info(
  info: Info,
  cwd: string,
  highlight_path: string,
  highlight_place: string,
  git_root: string,
): Item<ActionData> {
  const text = conv_text(info.text);
  const path_str = get_show_path(info.filename, cwd, git_root);
  const place_info = `${info.lnum} col ${info.col}`;
  const word = `${path_str}| ${place_info} |${text}`;
  return {
    word: word,
    highlights: [{
      name: "path_info",
      hl_group: highlight_path,
      col: 1,
      width: path_str.length,
    }, {
      name: "place_info",
      hl_group: highlight_place,
      col: path_str.length + 2,
      width: place_info.length + 2,
    }],
    action: {
      path: info.filename,
      lineNr: info.lnum,
      col: info.col,
      text: info.text,
    },
  };
}
async function get_git_root(cwd: string): Promise<string> {
  const p = Deno.run({
    cmd: ["git", "-C", cwd, "rev-parse", "--show-toplevel"],
    stdout: "piped",
  });
  const output: Uint8Array = await p.output();
  p.close();
  const git_root_list = (new TextDecoder().decode(output)).split(/\r\n|\n/);
  assertEquals(git_root_list.length, 2);
  return git_root_list[0];
}
function get_show_path(file_path: string, cwd: string, git_root: string) {
  if (is_child(git_root, file_path)) {
    return relative(cwd, file_path) as string;
  }
  return file_path + git_root;
}

function is_child(parent_dir: string, child_path: string): boolean {
  const parent_path = parent_dir.endsWith("/") ? parent_dir : `${parent_dir}/`;
  return child_path.startsWith(parent_path);
}
Deno.test("url test", () => {
  const url = new URL("./foo.js", "https://deno.land/");
  assertEquals(url.href, "https://deno.land/foo.js");
});

Deno.test("test_get_git_root", async () => {
  const script_dir = new URL("../", import.meta.url).pathname;
  const script_root = new URL("../../", import.meta.url).pathname;
  const git_root = await get_git_root(script_dir);
  assertEquals(script_root, `${git_root}/`);
});
