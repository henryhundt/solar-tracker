import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useState, useEffect } from "react";
import { useUpdateSite } from "@/hooks/use-sites";
import { Pencil, Key, User, Search, Loader2, CheckCircle2, Zap, AlertCircle, Sun } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSiteSchema, type PublicSite } from "@shared/schema";
import {
  buildAlsoEnergyProviderConfig,
  getAlsoEnergyApiSiteId,
  parseAlsoEnergyProviderConfig,
} from "@shared/alsoenergy";
import {
  getRecommendedEGaugeRegisterIds,
  parseEGaugeProviderConfig,
  toEGaugeSelectedRegisters,
  type EGaugeRegisterInspection,
  type EGaugeSelectionMode,
} from "@shared/egauge";
import { apiRequest } from "@/lib/queryClient";

const formSchema = insertSiteSchema.extend({});

type FormValues = z.infer<typeof formSchema>;

type CredentialMode = "direct" | "secret";

interface EditSiteDialogProps {
  site: PublicSite;
}

export function EditSiteDialog({ site }: EditSiteDialogProps) {
  const initialEGaugeConfig = parseEGaugeProviderConfig(site.providerConfig);
  const initialAlsoEnergyConfig = parseAlsoEnergyProviderConfig(site.providerConfig);
  const [open, setOpen] = useState(false);
  const initialCredentialMode: CredentialMode = site.credentialKey ? "secret" : "direct";
  const [credentialMode, setCredentialMode] = useState<CredentialMode>(initialCredentialMode);
  const [discoveredSites, setDiscoveredSites] = useState<Array<{ siteId: string; siteName: string; apiSiteId?: string | null }>>([]);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [alsoEnergyApiSiteId, setAlsoEnergyApiSiteId] = useState(initialAlsoEnergyConfig?.apiSiteId ?? getAlsoEnergyApiSiteId(site) ?? "");
  const [isInspectingEGauge, setIsInspectingEGauge] = useState(false);
  const [eGaugeRegisters, setEGaugeRegisters] = useState<EGaugeRegisterInspection[]>(
    (initialEGaugeConfig?.selectedRegisters ?? []).map((register) => ({
      ...register,
      isRecommendedSolar: false,
    }))
  );
  const [selectedEGaugeRegisterIds, setSelectedEGaugeRegisterIds] = useState<Set<number>>(
    new Set((initialEGaugeConfig?.selectedRegisters ?? []).map((register) => register.idx))
  );
  const [eGaugeSelectionMode, setEGaugeSelectionMode] = useState<EGaugeSelectionMode>(
    initialEGaugeConfig?.selectionMode ?? "manual"
  );
  const [eGaugeInspectError, setEGaugeInspectError] = useState<string | null>(null);
  const { mutate, isPending } = useUpdateSite();
  
  const { register, handleSubmit, formState: { errors }, reset, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: site.name,
      url: site.url,
      acCapacityKw: site.acCapacityKw ?? null,
      dcCapacityKw: site.dcCapacityKw ?? null,
      notes: site.notes ?? "",
      username: "",
      password: "",
      apiKey: "",
      credentialKey: site.credentialKey || "",
      siteIdentifier: site.siteIdentifier || "",
      providerConfig: site.providerConfig ?? null,
      scraperType: site.scraperType,
    }
  });

  const scraperType = watch("scraperType");
  const currentScraperType = scraperType || "mock";
  const isAlsoEnergy = currentScraperType === "alsoenergy";
  const isSolarEdgeApi = currentScraperType === "solaredge_api";
  const isSolarEdgeBrowser = currentScraperType === "solaredge_browser";
  const isSolarEdge = isSolarEdgeApi || isSolarEdgeBrowser;
  const capacityFieldOptions = {
    setValueAs: (value: string) => value === "" ? null : Number(value),
  };

  useEffect(() => {
    if (open) {
      reset({
        name: site.name,
        url: site.url,
        acCapacityKw: site.acCapacityKw ?? null,
        dcCapacityKw: site.dcCapacityKw ?? null,
        notes: site.notes ?? "",
        username: "",
        password: "",
        apiKey: "",
        credentialKey: site.credentialKey || "",
        siteIdentifier: site.siteIdentifier || "",
        providerConfig: site.providerConfig ?? null,
        scraperType: site.scraperType,
      });
      setCredentialMode(site.credentialKey ? "secret" : "direct");
      setAlsoEnergyApiSiteId(parseAlsoEnergyProviderConfig(site.providerConfig)?.apiSiteId ?? getAlsoEnergyApiSiteId(site) ?? "");
      const config = parseEGaugeProviderConfig(site.providerConfig);
      const selectedRegisters = config?.selectedRegisters ?? [];
      setEGaugeRegisters(
        selectedRegisters.map((register) => ({
          ...register,
          isRecommendedSolar: false,
        }))
      );
      setSelectedEGaugeRegisterIds(new Set(selectedRegisters.map((register) => register.idx)));
      setEGaugeSelectionMode(config?.selectionMode ?? "manual");
      setEGaugeInspectError(null);
    }
  }, [open, site, reset]);

  const handleScraperTypeChange = (val: string) => {
    setValue("scraperType", val);
    setDiscoveredSites([]);
    setDiscoveryError(null);
    setEGaugeRegisters([]);
    setSelectedEGaugeRegisterIds(new Set());
    setEGaugeSelectionMode("manual");
    setEGaugeInspectError(null);
    if (val === "egauge") {
      setCredentialMode("direct");
      setValue("apiKey", "");
      setValue("siteIdentifier", "");
    } else if (val === "solaredge_api") {
      setCredentialMode("direct");
      setValue("username", "");
      setValue("password", "");
    }
  };

  const needsCredentials = currentScraperType !== "solaredge_api";
  const needsApiKey = currentScraperType === "solaredge_api";
  const showSiteIdentifierField = currentScraperType !== "egauge";
  const siteIdentifierLabel = currentScraperType === "solaredge_api" 
    ? "Site ID (from SolarEdge portal URL)"
    : currentScraperType === "alsoenergy"
    ? "Also Energy PowerTrack Site Key"
    : currentScraperType === "solaredge_browser"
    ? "SolarEdge Site ID or Site Name"
    : "Portal Site Name (optional)";
  const discoveryProviderName = isAlsoEnergy ? "Also Energy" : "SolarEdge";
  const discoveryButtonLabel = isSolarEdgeApi ? "Discover Sites from API Key" : "Discover Sites from Account";
  const discoveryLoadingLabel = isSolarEdgeApi ? "Checking API key..." : "Discovering...";
  const apiSecretHelperText = `Uses secret: ${watch("credentialKey") || "KEY"}_API_KEY`;

  const [validationError, setValidationError] = useState<string | null>(null);

  const toggleEGaugeRegisterSelection = (registerId: number) => {
    setSelectedEGaugeRegisterIds((previous) => {
      const next = new Set(previous);
      if (next.has(registerId)) {
        next.delete(registerId);
      } else {
        next.add(registerId);
      }
      return next;
    });
    setEGaugeSelectionMode("manual");
  };

  const useRecommendedEGaugeRegisters = () => {
    const recommendedIds = getRecommendedEGaugeRegisterIds(eGaugeRegisters);
    setSelectedEGaugeRegisterIds(new Set(recommendedIds));
    setEGaugeSelectionMode(recommendedIds.length > 0 ? "auto" : "manual");
  };

  const handleDiscoverSites = async () => {
    setIsDiscovering(true);
    setDiscoveryError(null);
    setDiscoveredSites([]);

    try {
      const username = watch("username");
      const password = watch("password");
      const credKey = watch("credentialKey");
      const apiKey = watch("apiKey");

      const response = await apiRequest(
        "POST",
        isAlsoEnergy ? "/api/alsoenergy/discover" : "/api/solaredge/discover",
        isAlsoEnergy
          ? {
              siteId: site.id,
              username: credentialMode === "direct" ? username : "",
              password: credentialMode === "direct" ? password : "",
              credentialKey: credentialMode === "secret" ? credKey : "",
              url: "",
            }
          : {
              siteId: site.id,
              scraperType: currentScraperType,
              username: isSolarEdgeBrowser && credentialMode === "direct" ? username : "",
              password: isSolarEdgeBrowser && credentialMode === "direct" ? password : "",
              credentialKey: credentialMode === "secret" ? credKey : "",
              apiKey: isSolarEdgeApi && credentialMode === "direct" ? apiKey : "",
            }
      );

      const data = await response.json();
      if (data.sites && data.sites.length > 0) {
        setDiscoveredSites(data.sites);
      } else {
        setDiscoveryError(`No ${discoveryProviderName} sites were found for this account.`);
      }
    } catch (error: any) {
      setDiscoveryError(error.message || `Failed to discover ${discoveryProviderName} sites. Check your credentials.`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const handleInspectEGauge = async () => {
    setIsInspectingEGauge(true);
    setEGaugeInspectError(null);

    try {
      const response = await apiRequest("POST", "/api/egauge/test", {
        siteId: site.id,
        url: watch("url"),
        username: credentialMode === "direct" ? watch("username") : "",
        password: credentialMode === "direct" ? watch("password") : "",
        credentialKey: credentialMode === "secret" ? watch("credentialKey") : "",
      });
      const data = await response.json();

      if (!data.success || !Array.isArray(data.registers)) {
        setEGaugeRegisters([]);
        setSelectedEGaugeRegisterIds(new Set());
        setEGaugeSelectionMode("manual");
        setEGaugeInspectError(data.error || "Inspecting eGauge registers failed.");
        return;
      }

      setEGaugeRegisters(data.registers);
      const availableIds = new Set(data.registers.map((register: EGaugeRegisterInspection) => register.idx));
      const preservedSelection = Array.from(selectedEGaugeRegisterIds).filter((id) => availableIds.has(id));

      if (preservedSelection.length > 0) {
        setSelectedEGaugeRegisterIds(new Set(preservedSelection));
      } else {
        const recommendedIds = getRecommendedEGaugeRegisterIds(data.registers);
        setSelectedEGaugeRegisterIds(new Set(recommendedIds));
        setEGaugeSelectionMode(recommendedIds.length > 0 ? "auto" : "manual");
      }
    } catch (error: any) {
      setEGaugeRegisters([]);
      setSelectedEGaugeRegisterIds(new Set());
      setEGaugeSelectionMode("manual");
      setEGaugeInspectError(error.message || "Inspect failed unexpectedly.");
    } finally {
      setIsInspectingEGauge(false);
    }
  };

  const onSubmit = (data: FormValues) => {
    setValidationError(null);
    const submitData: Partial<FormValues> = { ...data };
    submitData.providerConfig = null;
    submitData.notes = submitData.notes?.trim() ? submitData.notes.trim() : null;
    
    if (submitData.scraperType === "solaredge_api") {
      if (credentialMode === "direct") {
        const hasExistingDirectApiKey = !site.credentialKey && site.hasDirectApiKey;
        if ((!submitData.apiKey || submitData.apiKey.trim() === "") && !hasExistingDirectApiKey) {
          setValidationError("API key is required for SolarEdge API");
          return;
        }
        submitData.credentialKey = "";
      } else {
        if (!submitData.credentialKey || submitData.credentialKey.trim() === "") {
          setValidationError("Credential key is required when using a stored SolarEdge API key");
          return;
        }
        submitData.apiKey = "";
      }
      if (!submitData.siteIdentifier || submitData.siteIdentifier.trim() === "") {
        setValidationError("Site ID is required for SolarEdge API");
        return;
      }
      submitData.username = "";
      submitData.password = "";
      submitData.providerConfig = null;
    } else if (submitData.scraperType === "egauge") {
      const selectedRegisters = toEGaugeSelectedRegisters(eGaugeRegisters, selectedEGaugeRegisterIds);
      if (eGaugeRegisters.length === 0) {
        setValidationError("Inspect the eGauge meter and select one or more production registers before saving.");
        return;
      }
      if (selectedRegisters.length === 0) {
        setValidationError("Select at least one eGauge production register.");
        return;
      }

      submitData.apiKey = "";
      submitData.siteIdentifier = "";
      submitData.providerConfig = {
        selectionMode: eGaugeSelectionMode,
        selectedRegisters,
      };

      if (credentialMode === "direct") {
        submitData.credentialKey = "";
        if (!data.password) {
          delete submitData.password;
        }
      } else {
        if (!submitData.credentialKey || submitData.credentialKey.trim() === "") {
          setValidationError("Credential key is required when using stored secrets");
          return;
        }
        submitData.username = "";
        submitData.password = "";
      }
    } else if (submitData.scraperType === "alsoenergy") {
      if (credentialMode === "direct") {
        const hasExistingCredentials = !site.credentialKey && site.hasDirectCredentials;
        if ((!submitData.username || submitData.username.trim() === "") && !hasExistingCredentials) {
          setValidationError("Username is required for Also Energy");
          return;
        }
        submitData.credentialKey = "";
        if (!data.password) {
          delete submitData.password;
        }
      } else {
        if (!submitData.credentialKey || submitData.credentialKey.trim() === "") {
          setValidationError("Credential key is required when using stored secrets");
          return;
        }
        submitData.username = "";
        submitData.password = "";
      }
      if (!submitData.siteIdentifier || submitData.siteIdentifier.trim() === "") {
        setValidationError("A PowerTrack site key is required for Also Energy. Use 'Discover Sites' to auto-fill it.");
        return;
      }
      submitData.apiKey = "";
      submitData.siteIdentifier = submitData.siteIdentifier.trim().toUpperCase();
      submitData.providerConfig = buildAlsoEnergyProviderConfig({
        browserSiteKey: submitData.siteIdentifier,
        apiSiteId: alsoEnergyApiSiteId,
      });
    } else if (submitData.scraperType !== "mock") {
      if (credentialMode === "direct") {
        const hasExistingCredentials = !site.credentialKey && site.hasDirectCredentials;
        if ((!submitData.username || submitData.username.trim() === "") && !hasExistingCredentials) {
          setValidationError("Username is required");
          return;
        }
        submitData.credentialKey = "";
        if (!data.password) {
          delete submitData.password;
        }
      } else {
        if (!submitData.credentialKey || submitData.credentialKey.trim() === "") {
          setValidationError("Credential key is required when using stored secrets");
          return;
        }
        submitData.username = "";
        submitData.password = "";
      }
    } else {
      if (credentialMode === "secret") {
        submitData.username = "";
        submitData.password = "";
      } else {
        submitData.credentialKey = "";
        if (!data.password) {
          delete submitData.password;
        }
      }
      submitData.providerConfig = null;
    }

    if (!data.apiKey) {
      delete submitData.apiKey;
    }
    
    mutate({ id: site.id, ...submitData }, {
      onSuccess: () => {
        setOpen(false);
        setValidationError(null);
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button 
          variant="ghost" 
          size="icon" 
          className="text-muted-foreground hover:text-primary hover:bg-primary/10 rounded-lg"
          data-testid={`button-edit-site-${site.id}`}
        >
          <Pencil className="w-4 h-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px] rounded-2xl">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">Edit Site</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
          <div className="space-y-2">
            <Label htmlFor="edit-name">Site Name</Label>
            <Input id="edit-name" placeholder="e.g. Home Roof" {...register("name")} className="rounded-xl" data-testid="input-edit-name" />
            {errors.name && <span className="text-xs text-red-500">{errors.name.message}</span>}
          </div>
          
          <div className="space-y-2">
            <Label htmlFor="edit-url">Portal URL</Label>
            <Input id="edit-url" placeholder="https://portal.solar-provider.com" {...register("url")} className="rounded-xl" data-testid="input-edit-url" />
            {errors.url && <span className="text-xs text-red-500">{errors.url.message}</span>}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="edit-acCapacityKw">AC Size (kW)</Label>
              <Input
                id="edit-acCapacityKw"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 250"
                {...register("acCapacityKw", capacityFieldOptions)}
                className="rounded-xl"
                data-testid="input-edit-ac-capacity-kw"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-dcCapacityKw">DC Size (kW)</Label>
              <Input
                id="edit-dcCapacityKw"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g. 320"
                {...register("dcCapacityKw", capacityFieldOptions)}
                className="rounded-xl"
                data-testid="input-edit-dc-capacity-kw"
              />
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="edit-notes">System Notes</Label>
            <Textarea
              id="edit-notes"
              placeholder="Equipment notes, array details, inverter info, service notes..."
              {...register("notes")}
              className="rounded-xl min-h-24"
              data-testid="input-edit-site-notes"
            />
          </div>

          <div className="space-y-2">
            <Label>Scraper Type</Label>
            <Select onValueChange={handleScraperTypeChange} value={scraperType}>
              <SelectTrigger className="rounded-xl" data-testid="select-edit-scraper-type">
                <SelectValue placeholder="Select type" />
              </SelectTrigger>
              <SelectContent className="rounded-xl">
                <SelectItem value="mock">Mock (Demo Data)</SelectItem>
                <SelectItem value="solaredge_api">SolarEdge (API)</SelectItem>
                <SelectItem value="solaredge_browser">SolarEdge (Browser)</SelectItem>
                <SelectItem value="egauge">eGauge</SelectItem>
                <SelectItem value="alsoenergy">Also Energy PowerTrack</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {(isAlsoEnergy || isSolarEdge) && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">
                {isSolarEdgeApi
                  ? "Enter an API key or stored secret, then click below to list your SolarEdge sites."
                  : "Enter your credentials above, then click below to find your sites."}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleDiscoverSites}
                disabled={isDiscovering}
                className="rounded-xl w-full"
                data-testid="button-edit-discover-sites"
              >
                {isDiscovering ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {discoveryLoadingLabel}
                  </>
                ) : (
                  <>
                    <Search className="w-4 h-4 mr-2" />
                    {discoveryButtonLabel}
                  </>
                )}
              </Button>
              {discoveryError && (
                <p className="text-xs text-red-500" data-testid="text-edit-discovery-error">{discoveryError}</p>
              )}
              {discoveredSites.length > 0 && (
                <div className="border rounded-xl p-3 space-y-1 max-h-40 overflow-y-auto" data-testid="list-edit-discovered-sites">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Found {discoveredSites.length} site(s) — click to select:</p>
                  {discoveredSites.map((s) => (
                    <button
                      key={s.siteId}
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-lg hover:bg-accent text-sm transition-colors"
                      data-testid={`button-edit-select-site-${s.siteId}`}
                      onClick={() => {
                        setValue("siteIdentifier", String(s.siteId));
                        if (isAlsoEnergy) {
                          setAlsoEnergyApiSiteId(s.apiSiteId ?? "");
                        }
                      }}
                    >
                      <span className="font-medium">{s.siteName}</span>
                      <span className="text-muted-foreground ml-2">
                        {isAlsoEnergy ? "Key" : "Site ID"}: {s.siteId}
                        {isAlsoEnergy && s.apiSiteId ? ` • API ID: ${s.apiSiteId}` : ""}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          {showSiteIdentifierField && (
            <div className="space-y-2">
              <Label htmlFor="edit-siteIdentifier">{siteIdentifierLabel}</Label>
              <Input 
                id="edit-siteIdentifier" 
                placeholder={currentScraperType === "solaredge_api" ? "e.g. 1234567" : currentScraperType === "alsoenergy" ? "e.g. S41121" : "e.g. Main Building"} 
                {...register("siteIdentifier")} 
                className="rounded-xl"
                data-testid="input-edit-site-identifier"
              />
              <p className="text-xs text-muted-foreground">
                {currentScraperType === "solaredge_api" 
                  ? "The numeric Site ID from your SolarEdge portal URL"
                  : currentScraperType === "alsoenergy"
                  ? "Discover fills a PowerTrack site key like S41121. Keep this even if you later add an API site ID below."
                  : "For multi-site portals, enter the exact site name."}
              </p>
            </div>
          )}

          {currentScraperType === "alsoenergy" && (
            <div className="space-y-2">
              <Label htmlFor="edit-alsoenergy-api-site-id">Also Energy API Site ID (optional)</Label>
              <Input
                id="edit-alsoenergy-api-site-id"
                value={alsoEnergyApiSiteId}
                onChange={(event) => setAlsoEnergyApiSiteId(event.target.value)}
                placeholder="e.g. 12345"
                className="rounded-xl"
                data-testid="input-edit-alsoenergy-api-site-id"
              />
              <p className="text-xs text-muted-foreground">
                Leave blank for login-only accounts. If API access is enabled later, add the numeric site ID here and we will prefer the hourly API path.
              </p>
            </div>
          )}

          {needsApiKey && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>API Key Source</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={credentialMode === "direct" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCredentialMode("direct")}
                    className="flex-1 rounded-xl"
                    data-testid="button-edit-api-direct"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Enter API Key
                  </Button>
                  <Button
                    type="button"
                    variant={credentialMode === "secret" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCredentialMode("secret")}
                    className="flex-1 rounded-xl"
                    data-testid="button-edit-api-secret"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Use Stored Secret
                  </Button>
                </div>
              </div>

              {credentialMode === "direct" ? (
                <div className="space-y-2">
                  <Label htmlFor="edit-apiKey">API Key</Label>
                  <Input 
                    id="edit-apiKey" 
                    type="password"
                    placeholder={site.credentialKey ? "Enter API key to switch from secret mode" : "Leave blank to keep current"} 
                    {...register("apiKey")} 
                    className="rounded-xl font-mono"
                    data-testid="input-edit-api-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Generate from: SolarEdge Portal → Admin → Site Access → API Access
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="edit-credentialKey-api">Secret Key Prefix</Label>
                  <Input
                    id="edit-credentialKey-api"
                    placeholder="e.g. SOLAR_PORTAL_1"
                    {...register("credentialKey")}
                    className="rounded-xl font-mono"
                    data-testid="input-edit-api-credential-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    {apiSecretHelperText}
                  </p>
                </div>
              )}
            </div>
          )}

          {needsCredentials && (
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Credential Source</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={credentialMode === "direct" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCredentialMode("direct")}
                    className="flex-1 rounded-xl"
                    data-testid="button-edit-credential-direct"
                  >
                    <User className="w-4 h-4 mr-2" />
                    Enter Credentials
                  </Button>
                  <Button
                    type="button"
                    variant={credentialMode === "secret" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCredentialMode("secret")}
                    className="flex-1 rounded-xl"
                    data-testid="button-edit-credential-secret"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Use Stored Secret
                  </Button>
                </div>
              </div>

              {credentialMode === "direct" ? (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="edit-username">Username</Label>
                    <Input id="edit-username" {...register("username")} className="rounded-xl" data-testid="input-edit-username" />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="edit-password">Password</Label>
                    <Input id="edit-password" type="password" placeholder="Leave blank to keep current" {...register("password")} className="rounded-xl" data-testid="input-edit-password" />
                  </div>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="edit-credentialKey">Secret Key Prefix</Label>
                  <Input 
                    id="edit-credentialKey" 
                    placeholder="e.g. SOLAR_PORTAL_1" 
                    {...register("credentialKey")} 
                    className="rounded-xl font-mono"
                    data-testid="input-edit-credential-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    Uses secrets: {watch("credentialKey") || "KEY"}_USERNAME, {watch("credentialKey") || "KEY"}_PASSWORD, {watch("credentialKey") || "KEY"}_URL
                  </p>
                </div>
              )}
            </div>
          )}

          {currentScraperType === "egauge" && (
            <p className="text-xs text-muted-foreground">
              Username and password are optional for classic eGauge proxy meters that only expose the legacy XML API.
              They are still required for JSON WebAPI access.
            </p>
          )}

          {currentScraperType === "egauge" && (
            <div className="space-y-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleInspectEGauge}
                disabled={isInspectingEGauge}
                className="w-full rounded-xl"
                data-testid="button-edit-inspect-egauge"
              >
                {isInspectingEGauge ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    Inspecting Registers...
                  </>
                ) : (
                  <>
                    <Zap className="w-4 h-4 mr-2" />
                    Inspect eGauge Registers
                  </>
                )}
              </Button>

              {(eGaugeInspectError || eGaugeRegisters.length > 0) && (
                <div
                  className={`p-3 rounded-xl border text-sm space-y-2 ${
                    eGaugeRegisters.length > 0
                      ? "bg-green-50 border-green-200 dark:bg-green-950/30 dark:border-green-800"
                      : "bg-destructive/10 border-destructive/20"
                  }`}
                  data-testid="panel-edit-egauge-registers"
                >
                  {eGaugeRegisters.length > 0 ? (
                    <>
                      <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium">
                        <CheckCircle2 className="w-4 h-4 shrink-0" />
                        Meter inspected successfully
                      </div>
                      <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span>
                          Selected {selectedEGaugeRegisterIds.size} of {eGaugeRegisters.length} register(s)
                        </span>
                        <span className="uppercase tracking-wide">
                          Mode: {eGaugeSelectionMode}
                        </span>
                      </div>
                      <div className="space-y-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-xs text-muted-foreground font-medium">
                            Registers found ({eGaugeRegisters.length}):
                          </p>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={useRecommendedEGaugeRegisters}
                            className="h-7 px-2 text-xs"
                            disabled={getRecommendedEGaugeRegisterIds(eGaugeRegisters).length === 0}
                          >
                            Use Recommended
                          </Button>
                        </div>
                        <div className="max-h-36 overflow-y-auto space-y-1">
                          {eGaugeRegisters.map((register, index) => (
                            <label
                              key={register.idx}
                              className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-background/60 cursor-pointer"
                              data-testid={`row-edit-egauge-register-${register.idx}`}
                            >
                              <Checkbox
                                checked={selectedEGaugeRegisterIds.has(register.idx)}
                                onCheckedChange={() => toggleEGaugeRegisterSelection(register.idx)}
                              />
                              <div className="min-w-0 flex-1">
                                <span className="text-xs font-mono block truncate">{register.name}</span>
                                <span className="text-[11px] text-muted-foreground">
                                  IDX {register.idx}
                                  {typeof register.rate === "number" ? ` • ${Math.round(register.rate)} W now` : ""}
                                </span>
                              </div>
                              <div className="flex items-center gap-1 shrink-0">
                                <Badge variant="outline" className="text-xs py-0 px-1.5">
                                  {register.type}
                                </Badge>
                                {register.isRecommendedSolar && (
                                  <Badge className="text-xs py-0 px-1.5 bg-yellow-500 text-white border-0">
                                    <Sun className="w-3 h-3 mr-0.5" />
                                    Recommended
                                  </Badge>
                                )}
                              </div>
                            </label>
                          ))}
                        </div>
                        {getRecommendedEGaugeRegisterIds(eGaugeRegisters).length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            No obvious solar registers were detected automatically. Choose the production registers manually.
                          </p>
                        )}
                      </div>
                    </>
                  ) : (
                    <div className="flex items-start gap-2 text-destructive">
                      <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                      <span>{eGaugeInspectError || "Register inspection failed."}</span>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {validationError && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm" data-testid="text-edit-validation-error">
              {validationError}
            </div>
          )}

          <div className="pt-4 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
              Cancel
            </Button>
            <Button type="submit" disabled={isPending} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-save-site">
              {isPending ? "Saving..." : "Save Changes"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
