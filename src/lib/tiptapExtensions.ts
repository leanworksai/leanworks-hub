import StarterKit from "@tiptap/starter-kit";
import { Underline } from "@tiptap/extension-underline";
import { Link } from "@tiptap/extension-link";
import { TextAlign } from "@tiptap/extension-text-align";
import { Color } from "@tiptap/extension-color";
import TextStyle from "@tiptap/extension-text-style";
import Paragraph from "@tiptap/extension-paragraph";
import CodeBlockLowlight from "@tiptap/extension-code-block-lowlight";
import { Image } from "@tiptap/extension-image";
import ImageResize from "tiptap-extension-resize-image";
import { Markdown } from "tiptap-markdown";
import { common, createLowlight } from "lowlight";
import { tableExtensions } from "@/extensions/table";

const lowlight = createLowlight(common);

export function getTiptapExtensions() {
  return [
    StarterKit.configure({
      heading: {
        levels: [1, 2, 3],
      },
      paragraph: false,
      gapcursor: false,
      codeBlock: false,
    }),
    CodeBlockLowlight.configure({
      lowlight,
      defaultLanguage: "plaintext",
      HTMLAttributes: {
        class: "hljs",
      },
    }),
    Paragraph.extend({
      parseHTML() {
        return [{ tag: "p" }];
      },
      renderHTML({ HTMLAttributes }) {
        return [
          "p",
          {
            ...HTMLAttributes,
            style:
              "white-space: pre-wrap; word-break: break-word; overflow-wrap: break-word; hyphens: none; max-width: 100%; width: 100%; box-sizing: border-box;",
          },
          0,
        ];
      },
    }),
    Underline,
    Link.configure({
      openOnClick: false,
      HTMLAttributes: {
        class: "text-primary underline break-all",
        style: "word-break: break-all; overflow-wrap: anywhere;",
      },
    }),
    TextAlign.configure({
      types: ["heading", "paragraph", "tableCell"],
    }),
    ...tableExtensions,
    Color,
    TextStyle,
    Image.configure({
      inline: true,
      allowBase64: false,
      HTMLAttributes: {
        class: "editor-image",
      },
    }),
    ImageResize.configure({
      inline: true,
    }),
    Markdown.configure({
      html: true,
      transformPastedText: false,
      transformCopiedText: false,
    }),
  ];
}
