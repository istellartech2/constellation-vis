import pandas as pd
import matplotlib.pyplot as plt
import sys
import os

def plot_visibility(df):
    # Convert seconds to minutes
    df["Minute"] = df["Time(sec)"] / 60

    # Set up plot
    fig, ax = plt.subplots(figsize=(10, 6))

    for column in df.columns[1:-1]:  # Exclude 'Time(sec)' and 'Minute'
        ax.plot(df["Minute"], df[column], label=column)

    ax.set_xlabel("Elapsed Time (minutes)")
    ax.set_ylabel("Number of Visible Satellites")
    ax.set_title("Satellite Visibility per Ground Station")
    ax.set_ylim(bottom=0)
    ax.legend(loc="upper right")
    ax.grid(True)

    plt.tight_layout()
    plt.show()

def print_visibility_ratios(df):
    print("\n=== Satellite Visibility Ratios ===\n")
    for column in df.columns[1:-1]:  # Exclude 'Time(sec)' and 'Minute'
        counts = df[column].value_counts().sort_index()
        total = counts.sum()
        print(f"{column}")
        for vis_num in range(counts.index.min(), counts.index.max() + 1):
            ratio = (counts.get(vis_num, 0) / total) * 100
            print(f"{vis_num}: {ratio:.1f}%")
        print()

def main(filename):
    if not os.path.isfile(filename):
        print(f"Error: File '{filename}' not found.")
        print("Usage: python plot_visibility.py [filename.csv]")
        sys.exit(1)

    df = pd.read_csv(filename)

    if "Time(sec)" not in df.columns:
        print("Error: CSV must contain a 'Time(sec)' column.")
        sys.exit(1)

    df["Minute"] = df["Time(sec)"] / 60

    plot_visibility(df)
    print_visibility_ratios(df)

if __name__ == "__main__":
    filename = sys.argv[1] if len(sys.argv) > 1 else "report.csv"
    main(filename)
