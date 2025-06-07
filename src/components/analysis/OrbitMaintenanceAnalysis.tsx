import ReactECharts from "echarts-for-react";

export default function OrbitMaintenanceAnalysis() {
  const option = {
    title: {
      text: "軌道維持燃料解析",
      textStyle: {
        color: "#ed6d00"
      }
    },
    backgroundColor: "rgba(30, 32, 36, 0.95)",
    textStyle: {
      color: "#f1f1f1"
    },
    xAxis: {
      type: "category",
      data: ["Jan", "Feb", "Mar", "Apr", "May", "Jun"],
      axisLabel: { color: "#999faa" }
    },
    yAxis: {
      type: "value",
      name: "Fuel Usage (kg)",
      nameTextStyle: { color: "#999faa" },
      axisLabel: { color: "#999faa" }
    },
    series: [{
      data: [12, 15, 18, 14, 16, 20],
      type: "line",
      lineStyle: { color: "#ed6d00", width: 3 }
    }],
    grid: { left: 60, right: 20, top: 60, bottom: 40 }
  };

  return (
    <ReactECharts 
      option={option}
      style={{ height: "100%", width: "100%" }}
      theme="dark"
    />
  );
}