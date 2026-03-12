<script lang="ts">
  import { select } from "d3-selection";
  import type { ScaleBand, ScaleLinear, ScaleTime } from "d3-scale";
  import {
    axisTop,
    axisRight,
    axisBottom,
    axisLeft,
    axisLabelOffset,
  } from "@d3fc/d3fc-axis";

  interface Props {
    scale:
      | ScaleBand<string>
      | ScaleLinear<number, number>
      | ScaleTime<number, number>
      | undefined;
    height: number;
    width: number;
    margin: number;
    position: "top" | "right" | "bottom" | "left";
    formatter:
      | ((date: (x_value: string) => string) => string)
      | ((n: number | { valueOf(): number }) => string)
      | ((x_value: string) => string)
      | ((date: Date) => string);
    label?: string;
  }

  let {
    scale = $bindable(),
    height = $bindable(),
    width = $bindable(),
    margin,
    position,
    formatter,
    label = "",
  }: Props = $props();

  let axis: SVGGElement | undefined = $state();
  let transform = $state("0,0");

  const positionedAxis = (
    scale:
      | ScaleBand<string>
      | ScaleLinear<number, number>
      | ScaleTime<number, number>
      | undefined,
  ) => {
    if (position === "top") {
      return axisLabelOffset(axisTop(scale));
    } else if (position == "right") {
      return axisRight(scale);
    } else if (position === "bottom") {
      return axisLabelOffset(axisBottom(scale));
    } else if (position == "left") {
      return axisLeft(scale);
    }
  };

  const transitionAxis = () => {
    if (position === "top") {
      transform = `0,${margin}`;
    } else if (position == "right") {
      transform = `${width - margin},0`;
    } else if (position === "bottom") {
      transform = `0,${height - margin}`;
    } else if (position == "left") {
      transform = `${margin},0`;
    }
  };

  const enlargedScale = () => {
    if (!scale) return;

    const axis_scale = scale.copy();
    const range = axis_scale.range();
    let excess;

    if ("invert" in axis_scale === false) return;

    // Find how much more room is physical range is available than was specified
    // NOTE: A margins worth of extra space is allowed at the start and end
    if (position === "bottom" || position === "top") {
      excess = width - margin * 2 - (range[1] - range[0]);
    } else if (position == "left" || position == "right") {
      excess = height - margin * 2 - (range[1] - range[0]);
    }

    // Find the positions in the domain these uncovered extremes would have mapped to
    const extended_range = [range[0] - excess! / 2, range[1] + excess! / 2];
    const extended_domain = [
      axis_scale.invert(extended_range[0]),
      axis_scale.invert(extended_range[1]),
    ];

    const axis_extended = axis_scale.domain(extended_domain);

    if ("range" in axis_extended === false) return;

    // Modify the domain and range to cover the full available section
    return axis_extended.range(extended_range);
  };

  $effect(() => {
    if (height && width && margin && position && axis && scale) {
      const usedScale = "invert" in scale ? enlargedScale() : scale;
      const axis_creator = positionedAxis(usedScale)
        .tickSizeOuter(0)
        .tickSize(0)
        .tickFormat(formatter);

      // Limit ticks on continuous scales to prevent duplicate labels
      if ("ticks" in axis_creator) {
        // If it's a log scale (using .base), allow up to 10 ticks, otherwise 6.
        if (typeof scale.base === "function") {
          axis_creator.ticks(10);
        } else {
          axis_creator.ticks(6);
        }
      }

      axis_creator(select(axis));
      transitionAxis();

      // Hide domain line and any background rects created by d3fc
      select(axis)
        .selectAll("path")
        .style("stroke", "transparent")
        .style("fill", "transparent");
      select(axis)
        .selectAll("rect")
        .style("fill", "transparent")
        .style("stroke", "transparent");
      select(axis).selectAll("line").style("stroke", "transparent");

      // Style tick labels
      const texts = select(axis).selectAll("text");
      texts.style("fill", "#64748b");

      // Band scales (bar charts): horizontal, wrap long names
      if (position === "bottom" && !("invert" in scale)) {
        texts
          .style("text-anchor", "middle")
          .style("font-size", "10px")
          .style("fill", "#94a3b8")
          .attr("dy", "0.8em")
          .each(function () {
            const el = select(this);
            const fullText = el.text();
            if (fullText.length <= 14) return;
            // Split at nearest space to midpoint
            const mid = Math.floor(fullText.length / 2);
            let splitIdx = fullText.lastIndexOf(" ", mid);
            if (splitIdx <= 0) splitIdx = fullText.indexOf(" ", mid);
            if (splitIdx <= 0) return; // no space to split on
            const line1 = fullText.slice(0, splitIdx);
            const line2 = fullText.slice(splitIdx + 1);
            el.text("");
            el.append("tspan").attr("x", 0).attr("dy", "0em").text(line1);
            el.append("tspan").attr("x", 0).attr("dy", "1.15em").text(line2);
          });
      } else {
        texts.style("font-size", "11px");
      }
    }
  });
</script>

<g
  color="transparent"
  stroke="transparent"
  fill="transparent"
  bind:this={axis}
  transform="translate({transform})"
/>
{#if position === "top"}
  <text x={(width + margin) / 2} y={30} fill="#64748b" font-size="11"
    >{label}</text
  >
{:else if position === "right"}
  <text
    x={(height + margin) * -0.5}
    y={width - 10}
    fill="#64748b"
    font-size="11"
    transform="rotate(-90)">{label}</text
  >
{:else if position === "bottom"}
  <text
    x={(width + margin) / 2}
    y={height - margin + 40}
    fill="#64748b"
    font-size="11">{label}</text
  >
{:else if position === "left"}
  <text
    x={(height + margin) * -0.5}
    y={margin - 42}
    fill="#64748b"
    font-size="11"
    transform="rotate(-90)">{label}</text
  >
{/if}
