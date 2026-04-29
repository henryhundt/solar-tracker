import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { useState } from "react";
import { useCreateSite } from "@/hooks/use-sites";
import { Plus, Key, User, Search, Loader2, CheckCircle2, Zap, AlertCircle, Sun } from "lucide-react";
import { z } from "zod";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { insertSiteSchema } from "@shared/schema";
import { buildAlsoEnergyProviderConfig } from "@shared/alsoenergy";
import {
  getRecommendedEGaugeRegisterIds,
  toEGaugeSelectedRegisters,
  type EGaugeRegisterInspection,
  type EGaugeSelectionMode,
} from "@shared/egauge";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

const formSchema = insertSiteSchema.extend({});

type FormValues = z.infer<typeof formSchema>;

type CredentialMode = "direct" | "secret";

interface DiscoveredSite {
  siteId: string;
  siteName: string;
  apiSiteId?: string | null;
}

export function AddSiteDialog() {
  const [open, setOpen] = useState(false);
  const [credentialMode, setCredentialMode] = useState<CredentialMode>("direct");
  const [discoveredSites, setDiscoveredSites] = useState<DiscoveredSite[]>([]);
  const [selectedSiteIds, setSelectedSiteIds] = useState<Set<string>>(new Set());
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [discoveryError, setDiscoveryError] = useState<string | null>(null);
  const [isTestingEGauge, setIsTestingEGauge] = useState(false);
  const [eGaugeRegisters, setEGaugeRegisters] = useState<EGaugeRegisterInspection[]>([]);
  const [selectedEGaugeRegisterIds, setSelectedEGaugeRegisterIds] = useState<Set<number>>(new Set());
  const [eGaugeSelectionMode, setEGaugeSelectionMode] = useState<EGaugeSelectionMode>("manual");
  const [eGaugeInspectError, setEGaugeInspectError] = useState<string | null>(null);
  const { mutate, isPending } = useCreateSite();
  const { toast } = useToast();
  
  const { register, handleSubmit, formState: { errors }, reset, setValue, watch } = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      name: "",
      url: "",
      acCapacityKw: null,
      dcCapacityKw: null,
      notes: "",
      username: "",
      password: "",
      apiKey: "",
      credentialKey: "",
      siteIdentifier: "",
      providerConfig: null,
      scraperType: "mock",
    }
  });

  const scraperType = watch("scraperType") || "mock";
  const isAlsoEnergy = scraperType === "alsoenergy";
  const isSolarEdgeApi = scraperType === "solaredge_api";
  const isSolarEdgeBrowser = scraperType === "solaredge_browser";
  const isSolarEdge = isSolarEdgeApi || isSolarEdgeBrowser;
  const supportsAccountDiscovery = isAlsoEnergy || isSolarEdge;
  const capacityFieldOptions = {
    setValueAs: (value: string) => value === "" ? null : Number(value),
  };

  const handleScraperTypeChange = (val: string) => {
    setValue("scraperType", val);
    setDiscoveredSites([]);
    setSelectedSiteIds(new Set());
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

  const handleTestEGauge = async () => {
    setIsTestingEGauge(true);
    setEGaugeInspectError(null);
    try {
      const response = await apiRequest("POST", "/api/egauge/test", {
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
      setIsTestingEGauge(false);
    }
  };

  const needsCredentials = scraperType !== "solaredge_api";
  const needsApiKey = scraperType === "solaredge_api";
  const showSiteIdentifierField = scraperType !== "egauge";
  const siteIdentifierLabel = scraperType === "solaredge_api" 
    ? "Site ID (from SolarEdge portal URL)"
    : scraperType === "alsoenergy"
    ? "Also Energy PowerTrack Site Key"
    : scraperType === "solaredge_browser"
    ? "SolarEdge Site ID or Site Name"
    : "Portal Site Name (optional)";

  const bulkDialogTitle = isAlsoEnergy
    ? "Connect Also Energy Sites"
    : isSolarEdge
    ? "Connect SolarEdge Sites"
    : "Connect New Site";
  const discoveryProviderName = isAlsoEnergy ? "Also Energy" : "SolarEdge";
  const discoveryIdentifierLabel = isAlsoEnergy ? "PowerTrack key" : "Site ID";
  const discoveryButtonLabel = isSolarEdgeApi ? "Discover Sites from API Key" : "Discover Sites from Account";
  const discoveryLoadingLabel = isSolarEdgeApi
    ? "Checking SolarEdge API key..."
    : `Connecting to ${discoveryProviderName}...`;
  const directCredentialLabel = isSolarEdgeApi ? "Enter API Key" : "Enter Credentials";
  const credentialHelperText = isSolarEdgeApi
    ? `Uses secret: ${watch("credentialKey") || "KEY"}_API_KEY`
    : `Uses secrets: ${watch("credentialKey") || "KEY"}_USERNAME, ${watch("credentialKey") || "KEY"}_PASSWORD`;

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
    setSelectedSiteIds(new Set());

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
              username: credentialMode === "direct" ? username : "",
              password: credentialMode === "direct" ? password : "",
              credentialKey: credentialMode === "secret" ? credKey : "",
              url: "",
            }
          : {
              scraperType,
              username: isSolarEdgeBrowser && credentialMode === "direct" ? username : "",
              password: isSolarEdgeBrowser && credentialMode === "direct" ? password : "",
              credentialKey: credentialMode === "secret" ? credKey : "",
              apiKey: isSolarEdgeApi && credentialMode === "direct" ? apiKey : "",
            }
      );

      const data = await response.json();
      if (data.sites && data.sites.length > 0) {
        setDiscoveredSites(data.sites);
        setSelectedSiteIds(new Set(data.sites.map((s: DiscoveredSite) => s.siteId)));
      } else {
        setDiscoveryError(`No ${discoveryProviderName} sites were found for this account.`);
      }
    } catch (error: any) {
      setDiscoveryError(error.message || `Failed to discover ${discoveryProviderName} sites. Check your credentials.`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const toggleSiteSelection = (siteId: string) => {
    setSelectedSiteIds(prev => {
      const next = new Set(prev);
      if (next.has(siteId)) {
        next.delete(siteId);
      } else {
        next.add(siteId);
      }
      return next;
    });
  };

  const toggleAllSites = () => {
    if (selectedSiteIds.size === discoveredSites.length) {
      setSelectedSiteIds(new Set());
    } else {
      setSelectedSiteIds(new Set(discoveredSites.map(s => s.siteId)));
    }
  };

  const handleBulkAdd = async () => {
    if (selectedSiteIds.size === 0) return;

    setIsBulkAdding(true);
    setValidationError(null);

    try {
      const username = watch("username");
      const password = watch("password");
      const credKey = watch("credentialKey");
      const apiKey = watch("apiKey");

      const selectedSites = discoveredSites.filter(s => selectedSiteIds.has(s.siteId));

      const response = await apiRequest(
        "POST",
        isAlsoEnergy ? "/api/alsoenergy/bulk-add" : "/api/solaredge/bulk-add",
        isAlsoEnergy
          ? {
              username: credentialMode === "direct" ? username : "",
              password: credentialMode === "direct" ? password : "",
              credentialKey: credentialMode === "secret" ? credKey : "",
              url: "",
              sites: selectedSites,
            }
          : {
              scraperType,
              username: isSolarEdgeBrowser && credentialMode === "direct" ? username : "",
              password: isSolarEdgeBrowser && credentialMode === "direct" ? password : "",
              credentialKey: credentialMode === "secret" ? credKey : "",
              apiKey: isSolarEdgeApi && credentialMode === "direct" ? apiKey : "",
              sites: selectedSites,
            }
      );

      const data = await response.json();
      toast({
        title: "Sites Added",
        description: `Successfully added ${data.count} ${discoveryProviderName} site(s).`,
      });

      queryClient.invalidateQueries({ queryKey: ["/api/sites"] });
      setOpen(false);
      resetForm();
    } catch (error: any) {
      setValidationError(error.message || "Failed to add sites");
    } finally {
      setIsBulkAdding(false);
    }
  };

  const resetForm = () => {
    reset();
    setCredentialMode("direct");
    setValidationError(null);
    setDiscoveredSites([]);
    setSelectedSiteIds(new Set());
    setDiscoveryError(null);
    setEGaugeRegisters([]);
    setSelectedEGaugeRegisterIds(new Set());
    setEGaugeSelectionMode("manual");
    setEGaugeInspectError(null);
  };

  const onSubmit = (data: FormValues) => {
    setValidationError(null);
    const submitData = { ...data };
    submitData.providerConfig = null;
    submitData.notes = submitData.notes?.trim() ? submitData.notes.trim() : null;
    
    if (submitData.scraperType === "solaredge_api") {
      if (credentialMode === "direct") {
        if (!submitData.apiKey || submitData.apiKey.trim() === "") {
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
        if (!submitData.username || submitData.username.trim() === "") {
          setValidationError("Username is required for Also Energy");
          return;
        }
        if (!submitData.password || submitData.password.trim() === "") {
          setValidationError("Password is required for Also Energy");
          return;
        }
        submitData.credentialKey = "";
      } else {
        if (!submitData.credentialKey || submitData.credentialKey.trim() === "") {
          setValidationError("Credential key is required when using stored secrets");
          return;
        }
        submitData.username = "";
        submitData.password = "";
      }

      if (!submitData.siteIdentifier || submitData.siteIdentifier.trim() === "") {
        setValidationError("A PowerTrack site key is required for Also Energy. Use discovery to fill it automatically.");
        return;
      }

      submitData.providerConfig = buildAlsoEnergyProviderConfig({
        browserSiteKey: submitData.siteIdentifier,
      });
      submitData.siteIdentifier = submitData.siteIdentifier.trim().toUpperCase();
      submitData.apiKey = "";
    } else if (submitData.scraperType !== "mock") {
      if (credentialMode === "direct") {
        if (!submitData.username || submitData.username.trim() === "") {
          setValidationError("Username is required");
          return;
        }
        if (!submitData.password || submitData.password.trim() === "") {
          setValidationError("Password is required");
          return;
        }
        submitData.credentialKey = "";
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
      }
      submitData.providerConfig = null;
    }
    
    mutate(submitData, {
      onSuccess: () => {
        setOpen(false);
        resetForm();
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={(val) => { setOpen(val); if (!val) resetForm(); }}>
      <DialogTrigger asChild>
        <Button className="rounded-xl shadow-lg shadow-primary/25 hover:shadow-xl hover:shadow-primary/30 transition-all" data-testid="button-add-site">
          <Plus className="w-4 h-4 mr-2" />
          Add Site
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] rounded-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="font-display text-xl">
            {bulkDialogTitle}
          </DialogTitle>
        </DialogHeader>

        {supportsAccountDiscovery ? (
          <div className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label>Scraper Type</Label>
              <Select onValueChange={handleScraperTypeChange} value={scraperType}>
                <SelectTrigger className="rounded-xl" data-testid="select-scraper-type">
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
                    data-testid="button-credential-direct"
                  >
                    {isSolarEdgeApi ? <Key className="w-4 h-4 mr-2" /> : <User className="w-4 h-4 mr-2" />}
                    {directCredentialLabel}
                  </Button>
                  <Button
                    type="button"
                    variant={credentialMode === "secret" ? "default" : "outline"}
                    size="sm"
                    onClick={() => setCredentialMode("secret")}
                    className="flex-1 rounded-xl"
                    data-testid="button-credential-secret"
                  >
                    <Key className="w-4 h-4 mr-2" />
                    Use Stored Secret
                  </Button>
                </div>
              </div>

              {credentialMode === "direct" ? (
                isSolarEdgeApi ? (
                  <div className="space-y-2">
                    <Label htmlFor="se-apiKey">API Key</Label>
                    <Input
                      id="se-apiKey"
                      type="password"
                      {...register("apiKey")}
                      className="rounded-xl font-mono"
                      data-testid="input-api-key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Generate from: SolarEdge Portal → Admin → Site Access → API Access
                    </p>
                  </div>
                ) : (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="account-username">Username</Label>
                      <Input id="account-username" {...register("username")} className="rounded-xl" data-testid="input-username" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="account-password">Password</Label>
                      <Input id="account-password" type="password" {...register("password")} className="rounded-xl" data-testid="input-password" />
                    </div>
                  </div>
                )
              ) : (
                <div className="space-y-2">
                  <Label htmlFor="account-credentialKey">Secret Key Prefix</Label>
                  <Input 
                    id="account-credentialKey" 
                    placeholder="e.g. SOLAR_PORTAL_1" 
                    {...register("credentialKey")} 
                    className="rounded-xl font-mono"
                    data-testid="input-credential-key"
                  />
                  <p className="text-xs text-muted-foreground">
                    {credentialHelperText}
                  </p>
                </div>
              )}
            </div>

            <Button
              type="button"
              onClick={handleDiscoverSites}
              disabled={isDiscovering}
              className="rounded-xl w-full"
              data-testid="button-discover-sites"
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
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm" data-testid="text-discovery-error">
                {discoveryError}
              </div>
            )}

            {discoveredSites.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium">
                    Found {discoveredSites.length} site(s)
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={toggleAllSites}
                    className="text-xs"
                    data-testid="button-toggle-all"
                  >
                    {selectedSiteIds.size === discoveredSites.length ? "Deselect All" : "Select All"}
                  </Button>
                </div>
                <div className="border rounded-xl p-2 space-y-1 max-h-48 overflow-y-auto" data-testid="list-discovered-sites">
                  {discoveredSites.map((s) => (
                    <label
                      key={s.siteId}
                      className="flex items-center gap-3 w-full px-3 py-2 rounded-lg hover:bg-accent cursor-pointer transition-colors"
                      data-testid={`site-option-${s.siteId}`}
                    >
                      <Checkbox
                        checked={selectedSiteIds.has(s.siteId)}
                        onCheckedChange={() => toggleSiteSelection(s.siteId)}
                        data-testid={`checkbox-site-${s.siteId}`}
                      />
                      <div className="flex-1 min-w-0">
                        <span className="text-sm font-medium block truncate">{s.siteName}</span>
                        <span className="text-xs text-muted-foreground">
                          {discoveryIdentifierLabel}: {s.siteId}
                          {s.apiSiteId ? ` • API site ID: ${s.apiSiteId}` : ""}
                        </span>
                      </div>
                    </label>
                  ))}
                </div>

                <Button
                  type="button"
                  onClick={handleBulkAdd}
                  disabled={isBulkAdding || selectedSiteIds.size === 0}
                  className="rounded-xl w-full bg-primary text-primary-foreground hover:bg-primary/90"
                  data-testid="button-add-selected"
                >
                  {isBulkAdding ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Adding {selectedSiteIds.size} site(s)...
                    </>
                  ) : (
                    <>
                      <CheckCircle2 className="w-4 h-4 mr-2" />
                      Add {selectedSiteIds.size} Selected Site(s)
                    </>
                  )}
                </Button>
              </div>
            )}

            {validationError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm" data-testid="text-validation-error">
                {validationError}
              </div>
            )}

            {discoveredSites.length === 0 && (
              <div className="pt-2 flex justify-end">
                <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
                  Cancel
                </Button>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleSubmit(onSubmit)} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="name">Site Name</Label>
              <Input id="name" placeholder="e.g. Home Roof" {...register("name")} className="rounded-xl" data-testid="input-name" />
              {errors.name && <span className="text-xs text-red-500">{errors.name.message}</span>}
            </div>
            
            <div className="space-y-2">
              <Label htmlFor="url">Portal URL</Label>
              <Input id="url" placeholder="https://portal.solar-provider.com" {...register("url")} className="rounded-xl" data-testid="input-url" />
              {errors.url && <span className="text-xs text-red-500">{errors.url.message}</span>}
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="acCapacityKw">AC Size (kW)</Label>
                <Input
                  id="acCapacityKw"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 250"
                  {...register("acCapacityKw", capacityFieldOptions)}
                  className="rounded-xl"
                  data-testid="input-ac-capacity-kw"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="dcCapacityKw">DC Size (kW)</Label>
                <Input
                  id="dcCapacityKw"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="e.g. 320"
                  {...register("dcCapacityKw", capacityFieldOptions)}
                  className="rounded-xl"
                  data-testid="input-dc-capacity-kw"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="notes">System Notes</Label>
              <Textarea
                id="notes"
                placeholder="Equipment notes, array details, inverter info, service notes..."
                {...register("notes")}
                className="rounded-xl min-h-24"
                data-testid="input-site-notes"
              />
            </div>

            <div className="space-y-2">
              <Label>Scraper Type</Label>
              <Select onValueChange={handleScraperTypeChange} defaultValue="mock">
                <SelectTrigger className="rounded-xl" data-testid="select-scraper-type">
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

            {showSiteIdentifierField && (
              <div className="space-y-2">
                <Label htmlFor="siteIdentifier">{siteIdentifierLabel}</Label>
                <Input 
                  id="siteIdentifier" 
                  placeholder={scraperType === "solaredge_api" ? "e.g. 1234567" : scraperType === "alsoenergy" ? "e.g. S41121" : "e.g. Main Building"} 
                  {...register("siteIdentifier")} 
                  className="rounded-xl"
                  data-testid="input-site-identifier"
                />
                <p className="text-xs text-muted-foreground">
                  {scraperType === "solaredge_api" 
                    ? "The numeric Site ID from your SolarEdge portal URL (e.g. monitoring.solaredge.com/site/1234567)"
                    : scraperType === "alsoenergy"
                    ? "Use the discovered PowerTrack key. Numeric API site IDs are stored separately when available."
                    : "For multi-site portals, enter the exact site name as it appears on the dashboard."}
                </p>
              </div>
            )}

            {needsApiKey && (
              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <Input 
                  id="apiKey" 
                  type="password"
                  placeholder="Your API key" 
                  {...register("apiKey")} 
                  className="rounded-xl font-mono"
                  data-testid="input-api-key"
                />
                <p className="text-xs text-muted-foreground">
                  Generate from: SolarEdge Portal → Admin → Site Access → API Access
                </p>
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
                      data-testid="button-credential-direct"
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
                      data-testid="button-credential-secret"
                    >
                      <Key className="w-4 h-4 mr-2" />
                      Use Stored Secret
                    </Button>
                  </div>
                </div>

                {credentialMode === "direct" ? (
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label htmlFor="username">Username</Label>
                      <Input id="username" {...register("username")} className="rounded-xl" data-testid="input-username" />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="password">Password</Label>
                      <Input id="password" type="password" {...register("password")} className="rounded-xl" data-testid="input-password" />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <Label htmlFor="credentialKey">Secret Key Prefix</Label>
                    <Input 
                      id="credentialKey" 
                      placeholder="e.g. SOLAR_PORTAL_1" 
                      {...register("credentialKey")} 
                      className="rounded-xl font-mono"
                      data-testid="input-credential-key"
                    />
                    <p className="text-xs text-muted-foreground">
                      Uses secrets: {watch("credentialKey") || "KEY"}_USERNAME, {watch("credentialKey") || "KEY"}_PASSWORD, {watch("credentialKey") || "KEY"}_URL
                    </p>
                  </div>
                )}
              </div>
            )}

            {scraperType === "egauge" && (
              <p className="text-xs text-muted-foreground">
                Username and password are optional for classic eGauge proxy meters that only expose the legacy XML API.
                They are still required for JSON WebAPI access.
              </p>
            )}

            {scraperType === "egauge" && (
              <div className="space-y-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleTestEGauge}
                  disabled={isTestingEGauge}
                  className="w-full rounded-xl"
                  data-testid="button-test-egauge"
                >
                  {isTestingEGauge ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Testing Connection...
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
                    data-testid="panel-egauge-test-result"
                  >
                    {eGaugeRegisters.length > 0 ? (
                      <>
                        <div className="flex items-center gap-2 text-green-700 dark:text-green-400 font-medium" data-testid="text-test-success">
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
                        {eGaugeRegisters.length > 0 ? (
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
                            <div className="max-h-36 overflow-y-auto space-y-1" data-testid="list-egauge-registers">
                              {eGaugeRegisters.map((reg, i) => (
                                <label
                                  key={reg.idx}
                                  className="flex items-center gap-3 rounded-lg px-2 py-1 hover:bg-background/60 cursor-pointer"
                                  data-testid={`register-row-${i}`}
                                >
                                  <Checkbox
                                    checked={selectedEGaugeRegisterIds.has(reg.idx)}
                                    onCheckedChange={() => toggleEGaugeRegisterSelection(reg.idx)}
                                    data-testid={`checkbox-egauge-register-${reg.idx}`}
                                  />
                                  <div className="min-w-0 flex-1">
                                    <span className="text-xs font-mono block truncate">{reg.name}</span>
                                    <span className="text-[11px] text-muted-foreground">
                                      IDX {reg.idx}
                                      {typeof reg.rate === "number" ? ` • ${Math.round(reg.rate)} W now` : ""}
                                    </span>
                                  </div>
                                  <div className="flex items-center gap-1 shrink-0">
                                    <Badge variant="outline" className="text-xs py-0 px-1.5" data-testid={`register-type-${i}`}>
                                      {reg.type}
                                    </Badge>
                                    {reg.isRecommendedSolar && (
                                      <Badge className="text-xs py-0 px-1.5 bg-yellow-500 text-white border-0" data-testid={`register-solar-${i}`}>
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
                        ) : (
                          <p className="text-xs text-muted-foreground" data-testid="text-no-registers">
                            No registers returned by the device.
                          </p>
                        )}
                      </>
                    ) : (
                      <div className="flex items-start gap-2 text-destructive" data-testid="text-test-error">
                        <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                        <span>{eGaugeInspectError || "Register inspection failed."}</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}

            {validationError && (
              <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/20 text-destructive text-sm" data-testid="text-validation-error">
                {validationError}
              </div>
            )}

            <div className="pt-4 flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setOpen(false)} className="rounded-xl">
                Cancel
              </Button>
              <Button type="submit" disabled={isPending} className="rounded-xl bg-primary text-primary-foreground hover:bg-primary/90" data-testid="button-submit">
                {isPending ? "Connecting..." : "Add Site"}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
