import { useState } from "react";
import { Check, ChevronsUpDown, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

interface Model {
  id: string;
  name: string;
  pricing?: {
    prompt: string;
    completion: string;
  };
}

interface ModelComboboxProps {
  models: Model[];
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  isLoading?: boolean;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function ModelCombobox({
  models,
  value,
  onValueChange,
  placeholder = "Sélectionner un modèle",
  isLoading = false,
  disabled = false,
  className,
  testId,
}: ModelComboboxProps) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  const selectedModel = models.find((model) => model.id === value);

  const filteredModels = models.filter((model) =>
    model.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    model.id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className={cn("justify-between", className)}
          disabled={disabled || isLoading}
          data-testid={testId}
        >
          {isLoading ? (
            <div className="flex items-center gap-2">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Chargement des modèles...</span>
            </div>
          ) : selectedModel ? (
            <div className="flex flex-col items-start w-full overflow-hidden">
              <span className="font-medium truncate w-full">{selectedModel.name}</span>
              {selectedModel.pricing && (
                <span className="text-xs text-muted-foreground">
                  ${selectedModel.pricing.prompt} / ${selectedModel.pricing.completion}
                </span>
              )}
            </div>
          ) : (
            placeholder
          )}
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[400px] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput
            placeholder="Rechercher un modèle..."
            value={searchQuery}
            onValueChange={setSearchQuery}
            data-testid={`${testId}-search`}
          />
          <CommandList className="max-h-[300px] overflow-y-auto">
            <CommandEmpty>Aucun modèle trouvé.</CommandEmpty>
            <CommandGroup>
              {filteredModels.map((model) => (
                <CommandItem
                  key={model.id}
                  value={model.id}
                  onSelect={(currentValue) => {
                    onValueChange(currentValue);
                    setOpen(false);
                    setSearchQuery("");
                  }}
                  data-testid={`${testId}-option-${model.id}`}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4",
                      value === model.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col flex-1 overflow-hidden">
                    <span className="font-medium truncate">{model.name}</span>
                    {model.pricing && (
                      <span className="text-xs text-muted-foreground">
                        Prompt: ${model.pricing.prompt} | Completion: ${model.pricing.completion}
                      </span>
                    )}
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
