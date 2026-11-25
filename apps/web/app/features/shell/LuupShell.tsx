"use client";

import { Fragment, useMemo, useState, type ReactNode } from "react";
import { AppShell } from "@astryxdesign/core/AppShell";
import { TopNav } from "@astryxdesign/core/TopNav";
import { SideNav } from "@astryxdesign/core/SideNav";
import { DropdownMenu, DropdownMenuItem } from "@astryxdesign/core/DropdownMenu";
import { Divider } from "@astryxdesign/core/Divider";
import { Kbd } from "@astryxdesign/core/Kbd";
import { Button } from "@astryxdesign/core/Button";
import { IconButton } from "@astryxdesign/core/IconButton";
import { Icon } from "@astryxdesign/core/Icon";
import { Text } from "@astryxdesign/core/Text";
import { TextInput } from "@astryxdesign/core/TextInput";
import { StackItem } from "@astryxdesign/core/Stack";
import { TreeList, type TreeListItemData } from "@astryxdesign/core/TreeList";
import { CommandPalette } from "@astryxdesign/core/CommandPalette";
import { createStaticSource } from "@astryxdesign/core/Typeahead";
import { useHotkeys } from "@astryxdesign/core/hooks";
import { useToast } from "@astryxdesign/core/Toast";
import {
  BeakerIcon,
  DocumentTextIcon,
  FolderIcon,
  MagnifyingGlassIcon as SearchIcon,
} from "@heroicons/react/24/outline";

import { SettingsDialog, SettingsTrigger } from "../settings/SettingsDialog";

export type LuupShellNavId = "mill" | "chat" | "papers";

export type LuupShellProps = {
  children: ReactNode;
  active?: LuupShellNavId;
  paperTitles?: string[];
};

type MenuEntry = [label: string, shortcut: string];

const MENU_WIDTH = 240;

const MENUS: { label: string; groups: MenuEntry[][] }[] = [
  {
    label: "Luup",
    groups: [
      [
        ["Autoresearch", ""],
        ["Research Mill", ""],
      ],
    ],
  },
  {
    label: "View",
    groups: [
      [["Command Palette", "⌘K"]],
      [
        ["Mill", ""],
        ["Chat", ""],
        ["Papers", ""],
      ],
    ],
  },
];

/** Autoresearch 产品壳：形制学 Astryx `shell-nav`。 */
export function LuupShell({ children, active = "mill", paperTitles = [] }: LuupShellProps) {
  const showToast = useToast();
  const [isPaletteOpen, setIsPaletteOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [nav, setNav] = useState<LuupShellNavId>(active);

  const go = (id: string) => {
    if (id === "docs") {
      showToast({ body: "Autoresearch Mill · Astryx shell · Engine 硬闸", uniqueID: "docs" });
      return;
    }
    if (id === "mill" || id === "chat" || id === "papers") {
      setNav(id);
    }
    setIsPaletteOpen(false);
  };

  const tree = useMemo((): TreeListItemData[] => {
    const papers: TreeListItemData[] = paperTitles.map((title, i) => ({
      id: `paper-${i}`,
      label: <Text maxLines={1}>{title}</Text>,
      startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
      onClick: () => go("papers"),
    }));
    return [
      {
        id: "research",
        label: <Text maxLines={1}>Research</Text>,
        startContent: <Icon icon={FolderIcon} size="xsm" />,
        isExpanded: true,
        children: [
          {
            id: "mill",
            label: <Text maxLines={1}>Mill · 永动机</Text>,
            startContent: <Icon icon={BeakerIcon} size="xsm" />,
            isSelected: nav === "mill",
            onClick: () => go("mill"),
          },
          {
            id: "chat",
            label: <Text maxLines={1}>Single chat</Text>,
            startContent: <Icon icon={SearchIcon} size="xsm" />,
            isSelected: nav === "chat",
            onClick: () => go("chat"),
          },
          {
            id: "papers",
            label: <Text maxLines={1}>Papers</Text>,
            startContent: <Icon icon={DocumentTextIcon} size="xsm" />,
            isSelected: nav === "papers",
            isExpanded: true,
            children:
              papers.length > 0 ? papers : [{ id: "papers-empty", label: <Text maxLines={1}>(none yet)</Text> }],
          },
        ],
      },
    ];
  }, [nav, paperTitles]);

  const commands = useMemo(
    () => [
      { id: "mill", label: "Focus Research Mill" },
      { id: "chat", label: "Focus single-question chat" },
      { id: "papers", label: "Show papers" },
      { id: "docs", label: "About Luup Autoresearch" },
    ],
    [],
  );
  const searchSource = useMemo(() => createStaticSource(commands), [commands]);

  const openPalette = () => setIsPaletteOpen(true);
  useHotkeys([
    { keys: "meta+k", onPress: openPalette, allowInInputs: true },
    { keys: "ctrl+k", onPress: openPalette, allowInInputs: true },
  ]);

  return (
    <>
      <AppShell
        contentPadding={0}
        topNav={
          <TopNav
            label="Luup Autoresearch"
            startContent={
              <>
                {MENUS.map((menu) => (
                  <DropdownMenu
                    key={menu.label}
                    button={{ label: menu.label, variant: "ghost", size: "sm" }}
                    hasChevron={false}
                    menuWidth={MENU_WIDTH}
                  >
                    {menu.groups.map((group, gi) => (
                      <Fragment key={gi}>
                        {gi > 0 ? <Divider /> : null}
                        {group.map(([label, shortcut]) => (
                          <DropdownMenuItem
                            key={label}
                            label={label}
                            onClick={() => {
                              if (label.includes("Mill")) go("mill");
                              else if (label.includes("Palette")) openPalette();
                              else if (label.includes("Chat")) go("chat");
                              else if (label.includes("Papers")) go("papers");
                              else go("mill");
                            }}
                            endContent={shortcut ? <Kbd keys={shortcut} /> : undefined}
                          />
                        ))}
                      </Fragment>
                    ))}
                  </DropdownMenu>
                ))}
              </>
            }
            endContent={
              <>
                <StackItem size="fill" onClick={openPalette}>
                  <TextInput
                    label="Search"
                    isLabelHidden
                    size="sm"
                    width="100%"
                    startIcon={SearchIcon}
                    placeholder="Search · ⌘K"
                    value=""
                    onChange={() => {}}
                  />
                </StackItem>
                <IconButton
                  label="Open mill"
                  tooltip="Mill"
                  variant="ghost"
                  icon={<Icon icon={BeakerIcon} size="sm" />}
                  onClick={() => go("mill")}
                />
                <StackItem>
                  <SettingsTrigger onOpen={() => setSettingsOpen(true)} />
                </StackItem>
                <StackItem>
                  <Button label="Mill" variant="secondary" onClick={() => go("mill")} />
                </StackItem>
              </>
            }
          />
        }
        sideNav={
          <SideNav resizable={{ defaultWidth: 240, minWidth: 180, maxWidth: 360 }}>
            <TreeList items={tree} density="compact" />
          </SideNav>
        }
      >
        {children}
      </AppShell>
      <CommandPalette
        isOpen={isPaletteOpen}
        onOpenChange={setIsPaletteOpen}
        searchSource={searchSource}
        label="Luup commands"
        onValueChange={(value) => {
          go(value);
          setIsPaletteOpen(false);
        }}
      />
      <SettingsDialog open={settingsOpen} onOpenChange={setSettingsOpen} />
    </>
  );
}
