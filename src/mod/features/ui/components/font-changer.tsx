import { useEffect, useState } from "react";

import { ExpandableCard } from "@ui/components/ui/expandable-card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@ui/components/ui/select";
import { Input } from "@ui/components/ui/input";
import { Label } from "@ui/components/ui/label";
import { Switch } from "@ui/components/ui/switch";
import { If } from "@ui/components/ui/if";

import { Type } from "lucide-react";

import "@ui/assets/fonts/stylesheet.css";
import availableFontsRaw from "@ui/assets/fonts/fonts.json";
const availableFonts = availableFontsRaw.map((font) => font.name);

export function FontChanger() {
  const [customFontEnabled, setCustomFontEnabled] = useState(false);
  const [customFont, setCustomFont] = useState(availableFonts[0]);

  useEffect(() => {
    (async () => {
      let savedFont = await window.yandexMusicMod.getStorageValue("font-changer/savedFont");
      if (!savedFont) savedFont = availableFonts[0];
      const savedFontEnabled = (await window.yandexMusicMod.getStorageValue("font-changer/enabled")) || false;

      setCustomFontEnabled(savedFontEnabled || false);
      setCustomFont(savedFont);
    })();
  }, []);

  return (
    <ExpandableCard title="Замена шрифтов" icon={<Type className="h-4 w-4" />}>
      <div className="flex flex-col gap-5 pt-2 px-3">
        <div className="flex items-center gap-3">
          <Switch
            id="font-changer-toggle"
            checked={customFontEnabled}
            onCheckedChange={(enabled) => {
              setCustomFontEnabled(enabled);
              window.yandexMusicMod.setStorageValue("font-changer/enabled", enabled);
            }}
          />
          <Label htmlFor="font-changer-toggle" className="cursor-pointer">
            Заменить шрифты в приложении
          </Label>
        </div>

        <If condition={customFontEnabled}>
          <div className="flex gap-4 items-center justify-center">
            <span className="text-sm text-foreground">Шрифт:</span>
            <Select
              value={availableFonts.includes(customFont) ? customFont : "custom"}
              onValueChange={(value: string) => {
                if (value !== "custom") {
                  setCustomFont(value);
                  window.yandexMusicMod.setStorageValue("font-changer/savedFont", value);
                }
              }}
              disabled={!customFontEnabled}
            >
              <SelectTrigger className="w-full text-foreground">
                <SelectValue placeholder="Выбрать шрифт" />
              </SelectTrigger>
              <SelectContent>
                {availableFonts.map((font) => (
                  <SelectItem key={font} value={font}>{font}</SelectItem>
                ))}
                <SelectItem value="custom">Свой шрифт (указать ниже)</SelectItem>
              </SelectContent>
            </Select>
          </div>
          
          <div className="flex gap-4 items-center justify-center">
            <span className="text-sm text-foreground whitespace-nowrap">Имя шрифта:</span>
            <Input
              value={customFont}
              onChange={(e) => {
                setCustomFont(e.target.value);
                window.yandexMusicMod.setStorageValue("font-changer/savedFont", e.target.value);
              }}
              disabled={!customFontEnabled}
              placeholder="Comic Sans MS, Arial..."
              className="text-foreground"
            />
          </div>
        </If>
      </div>
    </ExpandableCard>
  );
}
