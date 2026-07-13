import {
  AfterViewInit,
  Component,
  ElementRef,
  OnDestroy,
  ViewEncapsulation,
  effect,
  input,
  viewChild,
} from '@angular/core';
import * as L from 'leaflet';
import type { Waypoint, WaypointKind } from './itinerary-map.types';

// `ViewEncapsulation.None` required: Leaflet CSS uses global selectors (bounded leak — component is lazy-loaded).
@Component({
  selector: 'app-map-canvas',
  template: `<div #host class="map-host" role="img" [attr.aria-label]="ariaLabel()"></div>`,
  styleUrl: './map-canvas.scss',
  encapsulation: ViewEncapsulation.None,
})
export class MapCanvasComponent implements AfterViewInit, OnDestroy {
  private readonly host = viewChild.required<ElementRef<HTMLDivElement>>('host');

  readonly waypoints = input.required<readonly Waypoint[]>();
  readonly title = input<string>('Itinerary');

  protected readonly ariaLabel = (): string => {
    const w = this.waypoints();
    return `${this.title()} map with ${w.length} ${w.length === 1 ? 'stop' : 'stops'}.`;
  };

  private map: L.Map | null = null;
  private layers: L.Layer[] = [];

  constructor() {
    effect(() => {
      const w = this.waypoints();
      if (this.map) this.repaint(w);
    });
  }

  ngAfterViewInit(): void {
    const node = this.host().nativeElement;

    this.map = L.map(node, {
      attributionControl: true,
      zoomControl: true,
      scrollWheelZoom: false,
    });

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 18,
      attribution: '&copy; OpenStreetMap',
    }).addTo(this.map);

    this.repaint(this.waypoints());
  }

  ngOnDestroy(): void {
    this.map?.remove();
    this.map = null;
    this.layers = [];
  }

  private repaint(waypoints: readonly Waypoint[]): void {
    if (!this.map) return;

    for (const layer of this.layers) layer.remove();
    this.layers = [];

    if (waypoints.length === 0) return;

    for (const w of waypoints) {
      const marker = L.marker([w.lat, w.lng], { icon: iconFor(w.kind) }).addTo(this.map);
      const popup = `<strong>${escapeHtml(w.name)}</strong>${
        w.note ? `<br><span class="map-popup-note">${escapeHtml(w.note)}</span>` : ''
      }`;
      marker.bindPopup(popup);
      this.layers.push(marker);
    }

    if (waypoints.length >= 2) {
      const line = L.polyline(
        waypoints.map((w) => [w.lat, w.lng]),
        { color: 'var(--mat-sys-primary)', weight: 3, opacity: 0.7, dashArray: '6 6' },
      ).addTo(this.map);
      this.layers.push(line);
    }

    const bounds = L.latLngBounds(waypoints.map((w) => [w.lat, w.lng] as [number, number]));
    this.map.fitBounds(bounds, { padding: [28, 28], maxZoom: 13 });

    // @defer may reveal the host at zero height; one invalidateSize on the next frame avoids jank.
    requestAnimationFrame(() => this.map?.invalidateSize());
  }
}

const KIND_COLOURS: Record<WaypointKind, string> = {
  origin: '#1f6feb',
  destination: '#a371f7',
  stay: '#3fb950',
  stop: '#d29922',
};

function iconFor(kind: WaypointKind): L.DivIcon {
  const colour = KIND_COLOURS[kind];
  const letter = kind.charAt(0).toUpperCase();
  return L.divIcon({
    className: 'map-pin-icon',
    html: `<span class="map-pin" style="background:${colour}">${letter}</span>`,
    iconSize: [24, 24],
    iconAnchor: [12, 12],
    popupAnchor: [0, -12],
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
