import {
  BaseSource,
  Item,
  SourceOptions,
} from "https://deno.land/x/ddu_vim@v.1.13.0/types.ts";
import { Denops, fn } from "https://deno.land/x/ddu_vim@v.1.13.0/deps.ts";
import { ActionData } from "https://deno.land/x/ddu_kind_file@v0.3.1/file.ts";

import { relative } from "https://deno.land/std@0.161.0/path/mod.ts";
import { assert } from "https://deno.land/std@0.161.0/testing/asserts.ts";

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
    const jump_if_one = true as boolean;
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

            for (const info of res) {
              items.push(
                get_item_from_info(info, cwd, highlight_path, highlight_place),
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
          jump_if_one,
        ) as Promise<boolean>;
        // The get_list is not succeeded because of no LSP server.
        if (await ret) {
          if (args.sourceParams.bufnr !== undefined) {
            await args.denops.eval(`win_gotoid(bufwinid(${ddu_bufnr}))`);
          }

          /** register functions to contoroller.*/
          const info = await gather_info();
          if (info.length > 1 || (info.length == 1 && !jump_if_one)) {
            controller.enqueue(info);
          }
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
): Item<ActionData> {
  const text = conv_text(info.text);
  const relativepath = relative(cwd, info.filename) as string;
  const place_info = `${info.lnum} col ${info.col}`;
  const word = `${relativepath}| ${place_info} |${text}`;
  return {
    word: word,
    highlights: [{
      name: "path_info",
      hl_group: highlight_path,
      col: 1,
      width: relativepath.length,
    }, {
      name: "place_info",
      hl_group: highlight_place,
      col: relativepath.length + 2,
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
